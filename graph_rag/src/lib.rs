//! L4 — Neo4j GraphRAG
//!
//! Ported from `files(9)/neo4j_graph.ts` (white paper §3, L4 layer).
//!
//! Graph traversal (DAG ancestry) + vector similarity in one query.
//! No pgvector. No separate vector DB. Neo4j handles both.
//!
//! Node types:  (:Memory) (:Vertex) (:Timeline) (:Policy)
//! Rel types:   [:PRECEDES] [:INFLUENCED] [:PART_OF] [:PARENT_OF]
//!
//! # Connection
//!
//! Reads `NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD` from env vars
//! (matching the `.env` file in the repo root).

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tracing::{info, warn};

use lite_notebook::receipt::{Origin, Receipt, ReceiptKind};
use lite_notebook::tashi_consensus::TashiVertex;

/// Cypher schema statements — run once on first start.
pub const SCHEMA_CYPHER: &[&str] = &[
    "CREATE CONSTRAINT memory_id IF NOT EXISTS FOR (m:Memory) REQUIRE m.id IS UNIQUE",
    "CREATE CONSTRAINT vertex_hash IF NOT EXISTS FOR (v:Vertex) REQUIRE v.hash IS UNIQUE",
    "CREATE CONSTRAINT timeline_id IF NOT EXISTS FOR (t:Timeline) REQUIRE t.id IS UNIQUE",
    "CREATE CONSTRAINT policy_id IF NOT EXISTS FOR (p:Policy) REQUIRE p.id IS UNIQUE",
    "CREATE INDEX memory_timestamp IF NOT EXISTS FOR (m:Memory) ON (m.timestamp)",
    "CREATE INDEX memory_type IF NOT EXISTS FOR (m:Memory) ON (m.type)",
    // Vector index — 384-dim cosine (Gemma 2B embeddings)
    "CREATE VECTOR INDEX memory_embedding IF NOT EXISTS FOR (m:Memory) ON (m.embedding) OPTIONS { indexConfig: { 'vector.dimensions': 384, 'vector.similarity_function': 'cosine' } }",
];

/// Configuration for the Neo4j connection.
#[derive(Clone, Debug)]
pub struct GraphConfig {
    pub uri: String,
    pub user: String,
    pub password: String,
    pub max_connection_pool: u32,
}

impl Default for GraphConfig {
    fn default() -> Self {
        Self {
            uri: std::env::var("NEO4J_URI").unwrap_or_else(|_| "bolt://127.0.0.1:7687".into()),
            user: std::env::var("NEO4J_USER").unwrap_or_else(|_| "neo4j".into()),
            password: std::env::var("NEO4J_PASSWORD").unwrap_or_else(|_| "".into()),
            max_connection_pool: 10,
        }
    }
}

/// A node in the Neo4j graph (result of a query).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphNode {
    pub id: String,
    pub label: String,
    pub properties: serde_json::Value,
}

/// A relationship between two nodes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphRelationship {
    pub from_id: String,
    pub to_id: String,
    pub rel_type: String,
    pub properties: serde_json::Value,
}

/// Result of a vector similarity search.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VectorSearchResult {
    pub receipt: Receipt,
    pub similarity: f32,
    pub distance: f32,
}

/// The GraphRAG client. In production, this connects to Neo4j via the
/// `neo4rs` crate. When Neo4j is unavailable, operations are no-ops
/// with warnings (graceful degradation).
pub struct GraphRag {
    config: GraphConfig,
    /// In-memory fallback when Neo4j is not running (for tests/dev)
    memory_fallback: parking_lot::RwLock<Vec<Receipt>>,
    /// Whether Neo4j is connected
    connected: parking_lot::RwLock<bool>,
}

impl GraphRag {
    pub fn new(config: GraphConfig) -> Arc<Self> {
        Arc::new(Self {
            config,
            memory_fallback: parking_lot::RwLock::new(Vec::new()),
            connected: parking_lot::RwLock::new(false),
        })
    }

    /// Try to connect to Neo4j. Returns false if unavailable (graceful degradation).
    pub async fn connect(&self) -> bool {
        // In production: use neo4rs crate to connect
        // let driver = neo4rs::GraphDB::new(&self.config.uri, &self.config.user, &self.config.password).await;
        // For now: mark as disconnected, use in-memory fallback
        *self.connected.write() = false;
        warn!("Neo4j not connected — using in-memory fallback (install neo4j + neo4rs crate for production)");
        false
    }

    /// Initialize the schema (constraints + indexes). Run once on first start.
    pub async fn init_schema(&self) -> anyhow::Result<()> {
        if !*self.connected.read() {
            info!("Skipping schema init — Neo4j not connected");
            return Ok(());
        }
        // In production: for each statement in SCHEMA_CYPHER, run via driver
        for stmt in SCHEMA_CYPHER {
            info!("Cypher: {}", stmt);
            // driver.run(stmt).await?;
        }
        Ok(())
    }

    /// Write a Receipt as a (:Memory) node.
    pub async fn write_receipt(&self, receipt: &Receipt) -> anyhow::Result<()> {
        if !*self.connected.read() {
            self.memory_fallback.write().push(receipt.clone());
            return Ok(());
        }
        // In production:
        // let cypher = "MERGE (m:Memory {id: $id}) SET m += {type: $type, ...}";
        // driver.run(cypher).with_params(...).await?;
        Ok(())
    }

    /// Write a TashiVertex + its parent relationships.
    pub async fn write_vertex(&self, vertex: &TashiVertex) -> anyhow::Result<()> {
        if !*self.connected.read() {
            return Ok(());
        }
        // MERGE (v:Vertex {hash: $hash})
        // SET v.creator = $creator, v.created_at = $created_at
        // WITH v
        // UNWIND $parents AS parent_hash
        // MATCH (parent:Vertex {hash: parent_hash})
        // MERGE (parent)-[:PARENT_OF]->(v)
        Ok(())
    }

    /// Vector similarity search — find k nearest neighbors by embedding.
    pub async fn vector_search(
        &self,
        query_embedding: &[f32],
        k: usize,
    ) -> anyhow::Result<Vec<VectorSearchResult>> {
        if !*self.connected.read() {
            // Fallback: linear scan over in-memory receipts
            let memory = self.memory_fallback.read();
            let mut scored: Vec<VectorSearchResult> = memory.iter()
                .filter_map(|r| {
                    r.embedding.as_ref().map(|emb| {
                        let sim = cosine_similarity(query_embedding, emb);
                        VectorSearchResult {
                            receipt: r.clone(),
                            similarity: sim,
                            distance: 1.0 - sim,
                        }
                    })
                })
                .collect();
            scored.sort_by(|a, b| b.similarity.partial_cmp(&a.similarity).unwrap_or(std::cmp::Ordering::Equal));
            scored.truncate(k);
            return Ok(scored);
        }

        // In production:
        // CALL db.index.vector.queryNodes('memory_embedding', $k, $embedding)
        // YIELD node, score
        // RETURN node, score
        Ok(Vec::new())
    }

    /// Get the DAG ancestry of a receipt (walk :PARENT_OF relationships).
    pub async fn get_ancestors(
        &self,
        receipt_id: &str,
        depth: usize,
    ) -> anyhow::Result<Vec<Receipt>> {
        if !*self.connected.read() {
            return Ok(Vec::new());
        }
        // MATCH (m:Memory {id: $id})-[:PARENT_OF*1..$depth]->(ancestor)
        // RETURN ancestor
        Ok(Vec::new())
    }

    /// Find receipts that influenced a given receipt (:INFLUENCED relationship).
    pub async fn get_influences(
        &self,
        receipt_id: &str,
    ) -> anyhow::Result<Vec<Receipt>> {
        if !*self.connected.read() {
            return Ok(Vec::new());
        }
        // MATCH (m:Memory {id: $id})<-[:INFLUENCED]-(influencer)
        // RETURN influencer
        Ok(Vec::new())
    }

    /// Check if Neo4j is connected.
    pub fn is_connected(&self) -> bool {
        *self.connected.read()
    }
}

/// Cosine similarity between two vectors.
fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let norm_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let norm_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm_a < 1e-9 || norm_b < 1e-9 {
        0.0
    } else {
        dot / (norm_a * norm_b)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cosine_similarity_handles_identical_vectors() {
        let a = vec![1.0, 2.0, 3.0];
        let sim = cosine_similarity(&a, &a);
        assert!((sim - 1.0).abs() < 0.001);
    }

    #[test]
    fn cosine_similarity_handles_orthogonal_vectors() {
        let a = vec![1.0, 0.0];
        let b = vec![0.0, 1.0];
        let sim = cosine_similarity(&a, &b);
        assert!(sim.abs() < 0.001);
    }

    #[tokio::test]
    async fn fallback_stores_receipts_in_memory() {
        let graph = GraphRag::new(GraphConfig::default());
        graph.connect().await;

        let receipt = Receipt::new(
            "s1".into(),
            Origin::User,
            ReceiptKind::Perception,
            "test".into(),
            None,
        ).with_embedding(vec![1.0, 0.0, 0.0]);

        graph.write_receipt(&receipt).await.unwrap();

        let results = graph.vector_search(&[1.0, 0.0, 0.0], 1).await.unwrap();
        assert_eq!(results.len(), 1);
        assert!((results[0].similarity - 1.0).abs() < 0.001);
    }
}
