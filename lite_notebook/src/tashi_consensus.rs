//! L2 — Tashi Consensus (Leaderless DAG)
//!
//! Ported from `files(9)/tashi_node.ts` (white paper §3, L2 layer).
//!
//! Each vertex = signed Receipt + parent hashes. Gossip over WebSocket
//! with NAT punching for IoT SIM. Offline queue flushes on reconnect.
//!
//! # Architecture
//!
//! ```text
//!   Local write → submit(atom, sig)
//!     → parents = current DAG tips
//!     → createVertex(atom, parents, creator, sig)
//!     → validateVertex (all parents known, hash reproducible)
//!     → accept into DAG + persist to JSONL
//!     → gossip to peers (or queue if offline)
//! ```
//!
//! Leaderless — no coordinator. Tips (leaf hashes) become parents for
//! the next vertex. Conflict resolution via DAG topology (like Nano).

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use sha2::{Sha256, Digest};
use tracing::{info, warn};

use crate::receipt::Receipt;

/// A signed vertex in the Tashi DAG.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TashiVertex {
    /// SHA-256 of {data, parents, creator}
    pub hash: String,
    /// Parent vertex hashes — empty for genesis
    pub parents: Vec<String>,
    /// Ed25519 signature from the creator's identity key
    pub signature: String,
    /// Creator's DID (decentralized identifier)
    pub creator: String,
    /// Creation timestamp (epoch nanos)
    pub created_at: i64,
    /// The Receipt payload (extends AtomicMemory concept)
    pub data: Receipt,
}

/// Validation result for a received vertex.
#[derive(Debug, Clone)]
pub struct VertexValidation {
    pub valid: bool,
    pub reason: Option<String>,
}

/// The Tashi consensus node — maintains a local DAG copy + gossips to peers.
pub struct TashiNode {
    /// DAG: vertex hash → vertex
    dag: Arc<RwLock<HashMap<String, TashiVertex>>>,
    /// DAG leaf hashes (tips) — candidates for next vertex's parents
    tips: Arc<RwLock<HashSet<String>>>,
    /// Vertices queued for offline peers — flushed on reconnect
    offline_queue: Arc<RwLock<Vec<TashiVertex>>>,
    /// This node's DID
    creator_did: String,
    /// JSONL audit file path (for persistence)
    jsonl_path: std::path::PathBuf,
}

impl TashiNode {
    pub fn new(creator_did: String, jsonl_path: std::path::PathBuf) -> Self {
        Self {
            dag: Arc::new(RwLock::new(HashMap::new())),
            tips: Arc::new(RwLock::new(HashSet::new())),
            offline_queue: Arc::new(RwLock::new(Vec::new())),
            creator_did,
            jsonl_path,
        }
    }

    /// Submit a new vertex (local write).
    /// Current tips become parents — leaderless, no coordinator.
    pub async fn submit(&self, atom: Receipt, signature: String) -> anyhow::Result<TashiVertex> {
        let parents: Vec<String> = {
            let tips = self.tips.read();
            tips.iter().cloned().collect()
        };

        let vertex = create_vertex(&atom, &parents, &self.creator_did, &signature);

        let known: HashSet<String> = {
            let dag = self.dag.read();
            dag.keys().cloned().collect()
        };

        let validation = validate_vertex(&vertex, &known);
        if !validation.valid {
            anyhow::bail!("Vertex rejected: {}", validation.reason.unwrap_or_default());
        }

        // Accept into DAG
        {
            let mut dag = self.dag.write();
            dag.insert(vertex.hash.clone(), vertex.clone());
        }
        // Remove parents from tips (they now have a child)
        {
            let mut tips = self.tips.write();
            for p in &parents {
                tips.remove(p);
            }
            tips.insert(vertex.hash.clone());
        }

        // Persist to JSONL
        self.persist_vertex(&vertex).await?;

        // Gossip to peers (or queue if offline)
        self.gossip(&vertex);

        Ok(vertex)
    }

    /// Receive a vertex from a peer via gossip.
    pub async fn receive_vertex(&self, vertex: TashiVertex) -> anyhow::Result<()> {
        // Already have it?
        if self.dag.read().contains_key(&vertex.hash) {
            return Ok(());
        }

        let known: HashSet<String> = {
            let dag = self.dag.read();
            dag.keys().cloned().collect()
        };

        let validation = validate_vertex(&vertex, &known);
        if !validation.valid {
            // May be out-of-order — request missing parents
            for parent_hash in &vertex.parents {
                if !self.dag.read().contains_key(parent_hash) {
                    warn!("Missing parent {} for vertex {}", parent_hash, vertex.hash);
                    // In production: request_vertex(parent_hash) via peer protocol
                }
            }
            return Ok(());
        }

        // Accept
        {
            let mut dag = self.dag.write();
            dag.insert(vertex.hash.clone(), vertex.clone());
        }
        {
            let mut tips = self.tips.write();
            for p in &vertex.parents {
                tips.remove(p);
            }
            tips.insert(vertex.hash.clone());
        }

        self.persist_vertex(&vertex).await?;

        // Forward to other peers (epidemic spread)
        self.gossip(&vertex);

        Ok(())
    }

    /// Flush the offline queue when a peer reconnects.
    pub fn flush_offline_queue(&self) -> Vec<TashiVertex> {
        let mut queue = self.offline_queue.write();
        let pending: Vec<TashiVertex> = queue.drain(..).collect();
        info!("Flushing {} queued vertices to reconnected peer", pending.len());
        pending
    }

    /// Get a vertex by hash.
    pub fn get_vertex(&self, hash: &str) -> Option<TashiVertex> {
        self.dag.read().get(hash).cloned()
    }

    /// Walk the DAG ancestors of a vertex (up to `depth` levels).
    pub fn get_ancestors(&self, hash: &str, depth: usize) -> Vec<TashiVertex> {
        let dag = self.dag.read();
        let mut results = Vec::new();
        let mut stack: Vec<(String, usize)> = vec![(hash.to_string(), 0)];

        while let Some((h, d)) = stack.pop() {
            if d >= depth {
                continue;
            }
            if let Some(v) = dag.get(&h) {
                results.push(v.clone());
                for parent in &v.parents {
                    stack.push((parent.clone(), d + 1));
                }
            }
        }

        results
    }

    /// Get all vertices created after the given hash's timestamp.
    pub fn get_vertices_since(&self, since_hash: &str) -> Vec<TashiVertex> {
        let dag = self.dag.read();
        let since_ts = dag.get(since_hash).map(|v| v.created_at).unwrap_or(0);
        let mut all: Vec<TashiVertex> = dag.values()
            .filter(|v| v.created_at > since_ts)
            .cloned()
            .collect();
        all.sort_by_key(|v| v.created_at);
        all
    }

    /// Queue a vertex for offline delivery (called when no peers are connected).
    fn gossip(&self, vertex: &TashiVertex) {
        // In production: iterate over connected WebSocket peers and send.
        // If no peers connected, queue for later.
        // The actual peer connection management lives in goose::a2a::A2ARelay.
        self.offline_queue.write().push(vertex.clone());
    }

    /// Persist a vertex to the JSONL audit file.
    async fn persist_vertex(&self, vertex: &TashiVertex) -> anyhow::Result<()> {
        let path = self.jsonl_path.clone();
        let line = serde_json::to_string(vertex)? + "\n";

        tokio::task::spawn_blocking(move || -> anyhow::Result<()> {
            use std::io::Write;
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let mut file = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&path)?;
            file.write_all(line.as_bytes())?;
            Ok(())
        }).await??;

        Ok(())
    }

    /// DAG size (total vertices).
    pub fn dag_size(&self) -> usize {
        self.dag.read().len()
    }

    /// Tip count (current leaves).
    pub fn tip_count(&self) -> usize {
        self.tips.read().len()
    }

    /// Offline queue depth.
    pub fn queue_depth(&self) -> usize {
        self.offline_queue.read().len()
    }

    /// This node's DID.
    pub fn creator_did(&self) -> &str {
        &self.creator_did
    }
}

/// Construct a vertex from an atom + parents + creator + signature.
pub fn create_vertex(
    atom: &Receipt,
    parents: &[String],
    creator: &str,
    signature: &str,
) -> TashiVertex {
    let hash = hash_vertex(atom, parents, creator);
    TashiVertex {
        hash,
        parents: parents.to_vec(),
        signature: signature.to_string(),
        creator: creator.to_string(),
        created_at: chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0),
        data: atom.clone(),
    }
}

/// Validate a received vertex.
pub fn validate_vertex(vertex: &TashiVertex, known_hashes: &HashSet<String>) -> VertexValidation {
    // Genesis vertex has no parents — always valid
    if vertex.parents.is_empty() {
        return VertexValidation { valid: true, reason: None };
    }

    // All parents must be known
    for parent in &vertex.parents {
        if !known_hashes.contains(parent) {
            return VertexValidation {
                valid: false,
                reason: Some(format!("Unknown parent hash: {}", parent)),
            };
        }
    }

    // Hash must be reproducible
    let expected = hash_vertex(&vertex.data, &vertex.parents, &vertex.creator);
    if expected != vertex.hash {
        return VertexValidation {
            valid: false,
            reason: Some("Hash mismatch — content tampered".into()),
        };
    }

    VertexValidation { valid: true, reason: None }
}

/// Compute the SHA-256 hash of {data, parents, creator}.
fn hash_vertex(atom: &Receipt, parents: &[String], creator: &str) -> String {
    let canonical = serde_json::json!({
        "data": atom,
        "parents": parents,
        "creator": creator,
    });
    let mut hasher = Sha256::new();
    hasher.update(canonical.to_string().as_bytes());
    format!("{:x}", hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::receipt::{Origin, Receipt, ReceiptKind};

    fn make_receipt(content: &str) -> Receipt {
        Receipt::new(
            "test-session".into(),
            Origin::User,
            ReceiptKind::Perception,
            content.into(),
            None,
        )
    }

    #[test]
    fn genesis_vertex_is_valid() {
        let atom = make_receipt("genesis");
        let vertex = create_vertex(&atom, &[], "did:ava:node-1", "sig123");
        let mut known = HashSet::new();
        known.insert("known_parent".to_string());
        let result = validate_vertex(&vertex, &known);
        assert!(result.valid);
    }

    #[test]
    fn vertex_with_unknown_parent_is_rejected() {
        let atom = make_receipt("child");
        let vertex = create_vertex(&atom, &["unknown_hash".to_string()], "did:ava:node-1", "sig123");
        let mut known = HashSet::new();
        known.insert("known_parent".to_string());
        let result = validate_vertex(&vertex, &known);
        assert!(!result.valid);
        assert!(result.reason.unwrap().contains("Unknown parent"));
    }

    #[test]
    fn hash_mismatch_is_detected() {
        let atom = make_receipt("data");
        let mut vertex = create_vertex(&atom, &["known_parent".to_string()], "did:ava:node-1", "sig123");
        // Tamper the hash field — validation should detect the mismatch
        // between the stored hash and the recomputed hash
        vertex.hash = "tampered_hash".into();
        let mut known = HashSet::new();
        known.insert("known_parent".to_string());
        let result = validate_vertex(&vertex, &known);
        assert!(!result.valid);
        assert!(result.reason.unwrap().contains("Hash mismatch"));
    }

    #[tokio::test]
    async fn submit_creates_genesis_then_child() {
        let dir = tempfile::tempdir().unwrap();
        let node = TashiNode::new(
            "did:ava:node-1".into(),
            dir.path().join("tashi.jsonl"),
        );

        // Genesis vertex
        let atom1 = make_receipt("first");
        let v1 = node.submit(atom1, "sig1".into()).await.unwrap();
        assert_eq!(node.dag_size(), 1);
        assert_eq!(node.tip_count(), 1);

        // Child vertex — parent should be v1
        let atom2 = make_receipt("second");
        let v2 = node.submit(atom2, "sig2".into()).await.unwrap();
        assert_eq!(v2.parents, vec![v1.hash]);
        assert_eq!(node.dag_size(), 2);
        assert_eq!(node.tip_count(), 1); // v1 no longer a tip, v2 is
    }

    #[tokio::test]
    async fn receive_vertex_accepts_valid() {
        let dir = tempfile::tempdir().unwrap();
        let node = TashiNode::new(
            "did:ava:node-1".into(),
            dir.path().join("tashi.jsonl"),
        );

        let atom = make_receipt("from peer");
        let vertex = create_vertex(&atom, &[], "did:ava:node-2", "peer_sig");
        node.receive_vertex(vertex).await.unwrap();
        assert_eq!(node.dag_size(), 1);
    }
}
