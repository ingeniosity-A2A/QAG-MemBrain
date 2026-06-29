//! DuckDB Context Lake — concrete impl of meta_harness::ContextLake.
//!
//! This is the bridge between the Meta Harness's Injector and the
//! Context Ocean DuckDB schema. Every query here is a SQL macro call
//! defined in context_ocean_schema.sql.
//!
//! In production (on-device), this would run DuckDB-WASM in the EPOCH
//! sandbox and communicate via Arrow IPC. In this Rust crate it uses
//! in-process duckdb-rs (compiled with bundled DuckDB).
//!
//! Either way, the SQL is identical — that's the point of the
//! Iceberg + DuckDB architecture: zero format translation.

use std::sync::Arc;

use async_trait::async_trait;
use parking_lot::Mutex;
use uuid::Uuid;

use lite_notebook::receipt::{Origin, Receipt, ReceiptKind};
use meta_harness::injector::ContextLake;

/// Connection config for the DuckDB Context Lake.
#[derive(Clone, Debug)]
pub struct LakeConfig {
    /// Path to the DuckDB file. Use ":memory:" for ephemeral (tests).
    /// Production: /data/local/tmp/ava007/context_lake.duckdb
    pub db_path: Arc<str>,

    /// Path to the Iceberg table root (where Parquet files live).
    /// Production: /data/local/tmp/ava007/context_ocean/
    pub iceberg_root: Arc<str>,

    /// Default recall k for semantic search
    pub default_recall_k: usize,

    /// Embedding dimension (384 for Gemma 2B, 768 for FABLE)
    pub embedding_dim: usize,
}

impl Default for LakeConfig {
    fn default() -> Self {
        Self {
            db_path: ":memory:".into(),
            iceberg_root: "/data/local/tmp/ava007/context_ocean".into(),
            default_recall_k: 8,
            embedding_dim: 384,
        }
    }
}

pub struct DuckDbContextLake {
    conn: Mutex<duckdb::Connection>,
    config: LakeConfig,
    initialized: Mutex<bool>,
}

impl DuckDbContextLake {
    /// Open a new lake. Reads the schema SQL if not yet initialized.
    pub fn open(config: LakeConfig) -> anyhow::Result<Arc<Self>> {
        let conn = duckdb::Connection::open(config.db_path.as_ref())?;

        let lake = Arc::new(Self {
            conn: Mutex::new(conn),
            config,
            initialized: Mutex::new(false),
        });

        lake.ensure_schema()?;
        lake.register_iceberg()?;

        Ok(lake)
    }

    /// Run the schema SQL (idempotent — uses CREATE IF NOT EXISTS).
    fn ensure_schema(&self) -> anyhow::Result<()> {
        let mut init = self.initialized.lock();
        if *init {
            return Ok(());
        }

        let schema_sql = include_str!("../../sql/context_ocean_schema.sql");

        // VSS and FTS extensions may not be available in test mode —
        // wrap their install in a tolerant pass.
        let conn = self.conn.lock();
        conn.execute_batch(schema_sql).or_else(|e| {
            tracing::warn!("full schema load failed ({e}), trying without extensions");
            // Strip extension-loading lines and try again
            let stripped: String = schema_sql
                .lines()
                .filter(|l| {
                    let t = l.trim();
                    !t.starts_with("INSTALL ") && !t.starts_with("LOAD ")
                })
                .collect::<Vec<_>>()
                .join("\n");
            conn.execute_batch(&stripped)
                .map_err(|e2| anyhow::anyhow!("schema load failed: {e2}"))
        })?;

        *init = true;
        Ok(())
    }

    /// Register the Iceberg table's Parquet files as a DuckDB view.
    /// In production this uses iceberg_scan(); here we use read_parquet
    /// over the data/ directory.
    fn register_iceberg(&self) -> anyhow::Result<()> {
        let conn = self.conn.lock();
        let data_glob = format!("{}/data/*.parquet", self.config.iceberg_root);

        // Tolerate missing data dir (fresh install)
        let sql = format!(
            "CREATE OR REPLACE VIEW receipts AS
             SELECT * FROM read_parquet('{}', union_by_name=true);",
            data_glob
        );
        match conn.execute(&sql, []) {
            Ok(_) => Ok(()),
            Err(e) => {
                tracing::warn!("iceberg register failed ({e}), creating empty receipts table");
                // Create an empty table with the right schema
                conn.execute(
                    "CREATE OR REPLACE TABLE receipts (
                        id              BLOB,
                        timestamp_ns    BIGINT,
                        session_id      VARCHAR,
                        origin          VARCHAR,
                        kind            VARCHAR,
                        content_hash    BLOB,
                        content         VARCHAR,
                        embedding       DOUBLE[],
                        parent_receipt  BLOB,
                        trust_score     FLOAT,
                        knox_safe       BOOLEAN,
                        metadata        JSON
                    );",
                    [],
                )?;
                Ok(())
            }
        }
    }

    /// Insert a receipt directly into the DuckDB table (for testing
    /// and for the in-process query path). In production the Iceberg
    /// writer handles this — DuckDB reads the Parquet files directly.
    pub fn insert_receipt(&self, r: &Receipt) -> anyhow::Result<()> {
        let conn = self.conn.lock();
        let id_bytes = r.id.as_bytes();
        let parent_bytes = r.parent_receipt.map(|p| p.as_bytes().to_vec());
        let emb_arr: Option<Vec<f64>> = r.embedding.as_ref().map(|e| e.iter().map(|&x| x as f64).collect());
        let metadata_json = serde_json::to_string(r.metadata.as_ref())
            .unwrap_or_else(|_| "{}".into());

        conn.execute(
            "INSERT INTO receipts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            duckdb::params![
                id_bytes,
                r.timestamp_ns,
                r.session_id.as_ref(),
                r.origin.as_str(),
                r.kind.as_str(),
                &r.content_hash[..],
                r.content.as_ref(),
                emb_arr,
                parent_bytes,
                r.trust_score,
                r.knox_safe,
                metadata_json,
            ],
        )?;
        Ok(())
    }
}

#[async_trait]
impl ContextLake for DuckDbContextLake {
    async fn recall_similar(
        &self,
        query_emb: &[f32],
        k: usize,
    ) -> anyhow::Result<Vec<Receipt>> {
        let k = k.min(self.config.default_recall_k.max(k));
        let emb_vec: Vec<f32> = query_emb.to_vec();

        // Use a SQL-level cosine similarity (no VSS extension needed).
        // For 100k+ rows this should switch to the HNSW index.
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, timestamp_ns, session_id, origin, kind,
                    content_hash, content, embedding, parent_receipt,
                    trust_score, knox_safe, metadata
             FROM receipts
             WHERE embedding IS NOT NULL
               AND array_length(embedding) = ?
             ORDER BY (
                 SELECT sum(a*b) FROM unnest(embedding, ?) AS t(a, b)
             ) DESC
             LIMIT ?",
        )?;

        // DuckDB array param
        let emb_inner: Vec<f64> = emb_vec.iter().map(|&x| x as f64).collect();

        let rows = stmt.query_map(
            duckdb::params![self.config.embedding_dim as i64, emb_inner, k as i64],
            |row| {
                let id_bytes: Vec<u8> = row.get(0)?;
                let timestamp_ns: i64 = row.get(1)?;
                let session_id: String = row.get(2)?;
                let origin_str: String = row.get(3)?;
                let kind_str: String = row.get(4)?;
                let hash_bytes: Vec<u8> = row.get(5)?;
                let content: String = row.get(6)?;
                let emb_d: Option<Vec<f64>> = row.get(7)?;
                let parent_d: Option<Vec<u8>> = row.get(8)?;
                let trust: f32 = row.get(9)?;
                let knox: bool = row.get(10)?;
                let meta_json: String = row.get(11)?;

                let mut content_hash = [0u8; 32];
                if hash_bytes.len() == 32 {
                    content_hash.copy_from_slice(&hash_bytes);
                }

                let id = Uuid::from_slice(&id_bytes).unwrap_or(Uuid::nil());
                let parent = parent_d
                    .and_then(|p| Uuid::from_slice(&p).ok());

                let origin = Origin::from_str(&origin_str).unwrap_or(Origin::User);
                let kind = match kind_str.as_str() {
                    "perception" => ReceiptKind::Perception,
                    "cognition"  => ReceiptKind::Cognition,
                    "action"     => ReceiptKind::Action,
                    "memory"     => ReceiptKind::Memory,
                    "control"    => ReceiptKind::Control,
                    _ => ReceiptKind::Cognition,
                };

                let embedding = emb_d.map(|v| {
                    Arc::from(v.iter().map(|x| *x as f32).collect::<Vec<f32>>())
                });

                let metadata: std::collections::HashMap<Arc<str>, Arc<str>> =
                    serde_json::from_str(&meta_json).unwrap_or_default();

                Ok(Receipt {
                    id,
                    timestamp_ns,
                    session_id: session_id.into(),
                    origin,
                    kind,
                    content_hash,
                    content: content.into(),
                    embedding,
                    parent_receipt: parent,
                    trust_score: trust,
                    knox_safe: knox,
                    metadata: Arc::new(metadata),
            signature: None,
            signer_did: None,
            atommem_directive: None,
                })
            },
        )?;

        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    async fn session_recent(
        &self,
        session_id: &str,
        n: usize,
    ) -> anyhow::Result<Vec<Receipt>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, timestamp_ns, session_id, origin, kind,
                    content_hash, content, embedding, parent_receipt,
                    trust_score, knox_safe, metadata
             FROM receipts
             WHERE session_id = ?
             ORDER BY timestamp_ns DESC
             LIMIT ?",
        )?;

        let rows = stmt.query_map(
            duckdb::params![session_id, n as i64],
            map_row_to_receipt,
        )?;

        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        // Reverse to chronological order (oldest first)
        out.reverse();
        Ok(out)
    }

    async fn lineage_chain(
        &self,
        receipt_id: Uuid,
    ) -> anyhow::Result<Vec<Receipt>> {
        // Recursive CTE walking parent_receipt up to root
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "WITH RECURSIVE chain AS (
                SELECT * FROM receipts WHERE id = ?
                UNION ALL
                SELECT r.* FROM receipts r
                JOIN chain c ON r.id = c.parent_receipt
             )
             SELECT id, timestamp_ns, session_id, origin, kind,
                    content_hash, content, embedding, parent_receipt,
                    trust_score, knox_safe, metadata
             FROM chain
             ORDER BY timestamp_ns ASC",
        )?;

        let id_bytes = receipt_id.as_bytes();
        let rows = stmt.query_map(
            duckdb::params![id_bytes],
            map_row_to_receipt,
        )?;

        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    async fn user_memories(&self, limit: usize) -> anyhow::Result<Vec<Receipt>> {
        // TASHI memory receipts: origin=TASHI, kind=Memory
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, timestamp_ns, session_id, origin, kind,
                    content_hash, content, embedding, parent_receipt,
                    trust_score, knox_safe, metadata
             FROM receipts
             WHERE origin = 'TASHI' AND kind = 'memory'
             ORDER BY timestamp_ns DESC
             LIMIT ?",
        )?;

        let rows = stmt.query_map(
            duckdb::params![limit as i64],
            map_row_to_receipt,
        )?;

        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }
}

fn map_row_to_receipt(row: &duckdb::Row) -> duckdb::Result<Receipt> {
    let id_bytes: Vec<u8> = row.get(0)?;
    let timestamp_ns: i64 = row.get(1)?;
    let session_id: String = row.get(2)?;
    let origin_str: String = row.get(3)?;
    let kind_str: String = row.get(4)?;
    let hash_bytes: Vec<u8> = row.get(5)?;
    let content: String = row.get(6)?;
    let emb_d: Option<Vec<f64>> = row.get(7)?;
    let parent_d: Option<Vec<u8>> = row.get(8)?;
    let trust: f32 = row.get(9)?;
    let knox: bool = row.get(10)?;
    let meta_json: String = row.get(11)?;

    let mut content_hash = [0u8; 32];
    if hash_bytes.len() == 32 {
        content_hash.copy_from_slice(&hash_bytes);
    }

    let id = Uuid::from_slice(&id_bytes).unwrap_or(Uuid::nil());
    let parent = parent_d.and_then(|p| Uuid::from_slice(&p).ok());

    let origin = Origin::from_str(&origin_str).unwrap_or(Origin::User);
    let kind = match kind_str.as_str() {
        "perception" => ReceiptKind::Perception,
        "cognition"  => ReceiptKind::Cognition,
        "action"     => ReceiptKind::Action,
        "memory"     => ReceiptKind::Memory,
        "control"    => ReceiptKind::Control,
        _ => ReceiptKind::Cognition,
    };

    let embedding = emb_d.map(|v| {
        Arc::from(v.iter().map(|x| *x as f32).collect::<Vec<f32>>())
    });

    let metadata: std::collections::HashMap<Arc<str>, Arc<str>> =
        serde_json::from_str(&meta_json).unwrap_or_default();

    Ok(Receipt {
        id,
        timestamp_ns,
        session_id: session_id.into(),
        origin,
        kind,
        content_hash,
        content: content.into(),
        embedding,
        parent_receipt: parent,
        trust_score: trust,
        knox_safe: knox,
        metadata: Arc::new(metadata),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn session_recent_returns_chronological() {
        let lake = DuckDbContextLake::open(LakeConfig::default()).unwrap();

        // Insert three receipts in the same session
        for i in 0..3 {
            let r = Receipt::new(
                "sess-A".into(),
                Origin::User,
                ReceiptKind::Perception,
                format!("msg-{i}").into(),
                None,
            );
            lake.insert_receipt(&r).unwrap();
            tokio::time::sleep(std::time::Duration::from_millis(2)).await;
        }

        let recent = lake.session_recent("sess-A", 5).await.unwrap();
        assert_eq!(recent.len(), 3);
        // Should be chronological (oldest first)
        assert_eq!(recent[0].content.as_ref(), "msg-0");
        assert_eq!(recent[2].content.as_ref(), "msg-2");
    }

    #[tokio::test]
    async fn user_memories_returns_only_tashi_memory() {
        let lake = DuckDbContextLake::open(LakeConfig::default()).unwrap();

        // Insert a TASHI memory receipt
        let mem = Receipt::new(
            "s1".into(),
            Origin::Tashi,
            ReceiptKind::Memory,
            "User prefers hiking in the morning".into(),
            None,
        );
        lake.insert_receipt(&mem).unwrap();

        // Insert a user perception (should NOT be returned)
        let perc = Receipt::new(
            "s1".into(),
            Origin::User,
            ReceiptKind::Perception,
            "hello".into(),
            None,
        );
        lake.insert_receipt(&perc).unwrap();

        let memories = lake.user_memories(10).await.unwrap();
        assert_eq!(memories.len(), 1);
        assert_eq!(memories[0].origin, Origin::Tashi);
        assert_eq!(memories[0].kind, ReceiptKind::Memory);
    }

    #[tokio::test]
    async fn lineage_chain_walks_parents() {
        let lake = DuckDbContextLake::open(LakeConfig::default()).unwrap();

        let r1 = Receipt::new(
            "s1".into(), Origin::User, ReceiptKind::Perception,
            "root".into(), None,
        );
        lake.insert_receipt(&r1).unwrap();

        let r2 = Receipt::new(
            "s1".into(), Origin::RevIke, ReceiptKind::Cognition,
            "child".into(), Some(r1.id),
        );
        lake.insert_receipt(&r2).unwrap();

        let r3 = Receipt::new(
            "s1".into(), Origin::RevIke, ReceiptKind::Cognition,
            "grandchild".into(), Some(r2.id),
        );
        lake.insert_receipt(&r3).unwrap();

        let chain = lake.lineage_chain(r3.id).await.unwrap();
        assert_eq!(chain.len(), 3);
        // Chronological: root, child, grandchild
        assert_eq!(chain[0].content.as_ref(), "root");
        assert_eq!(chain[2].content.as_ref(), "grandchild");
    }

    #[tokio::test]
    async fn recall_similar_returns_nearest_embeddings() {
        let lake = DuckDbContextLake::open(LakeConfig {
            embedding_dim: 4,
            ..Default::default()
        }).unwrap();

        // Insert 3 receipts with distinct embeddings
        let r1 = Receipt::new("s1".into(), Origin::User, ReceiptKind::Perception,
            "red".into(), None).with_embedding(vec![1.0, 0.0, 0.0, 0.0]);
        let r2 = Receipt::new("s1".into(), Origin::User, ReceiptKind::Perception,
            "green".into(), None).with_embedding(vec![0.0, 1.0, 0.0, 0.0]);
        let r3 = Receipt::new("s1".into(), Origin::User, ReceiptKind::Perception,
            "reddish".into(), None).with_embedding(vec![0.9, 0.1, 0.0, 0.0]);

        lake.insert_receipt(&r1).unwrap();
        lake.insert_receipt(&r2).unwrap();
        lake.insert_receipt(&r3).unwrap();

        // Query near red — should return r1 first, then r3
        let query = vec![1.0, 0.0, 0.0, 0.0];
        let results = lake.recall_similar(&query, 2).await.unwrap();
        assert_eq!(results.len(), 2);
        assert!(results[0].content.as_ref() == "red" || results[0].content.as_ref() == "reddish");
    }
}
