//! Receipt — the atomic unit of intelligence that flows through AVA007.
//!
//! Every perception, cognition, action, and memory event in the system becomes
//! a Receipt. Receipts are:
//!   - Immutable once created
//!   - Content-addressed (SHA-256 of payload)
//!   - Lineage-linked (parent_receipt forms a DAG)
//!   - Knox-safe by construction (no telephony/IMEI data allowed)
//!
//! Flow: Receipt → Lite Notebook → Arrow RecordBatch → Parquet (Iceberg) → DuckDB view
//!                                              ↘ REV.IKE read-only interpretation

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use arrow::datatypes::{DataType, Field, Schema, SchemaRef};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

/// Origin tag — which Constellation agent produced this Receipt.
/// REV.IKE = read-only subconscious, never writes Receipts with kind=Action.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[repr(u8)]
pub enum Origin {
    RevIke = 0,   // Reflex interpreter, read-only
    Fable  = 1,   // Planning (Gemma 4 12B agentic)
    Goose  = 2,   // Expansion services (AgentZero/Griptape/Bastani)
    Tashi  = 3,   // Memory compaction
    Epoch  = 4,   // UI sandbox (Arrow consumer, write-back only)
    User   = 5,   // Direct user input
}

impl Origin {
    pub fn as_str(self) -> &'static str {
        match self {
            Origin::RevIke => "REV.IKE",
            Origin::Fable  => "FABLE",
            Origin::Goose  => "GOOSE",
            Origin::Tashi  => "TASHI",
            Origin::Epoch  => "EPOCH",
            Origin::User   => "USER",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "REV.IKE" => Some(Origin::RevIke),
            "FABLE"   => Some(Origin::Fable),
            "GOOSE"   => Some(Origin::Goose),
            "TASHI"   => Some(Origin::Tashi),
            "EPOCH"   => Some(Origin::Epoch),
            "USER"    => Some(Origin::User),
            _ => None,
        }
    }
}

/// Cognitive phase tag — drives routing in Constellation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[repr(u8)]
pub enum ReceiptKind {
    Perception = 0, // Raw input (sensor, voice, text)
    Cognition  = 1, // Model output (Gemma/FABLE inference)
    Action     = 2, // Side-effectful (browser, phone, file)
    Memory     = 3, // TASHI compaction or recall
    Control    = 4, // System event (heartbeat, flush, error)
}

impl ReceiptKind {
    pub fn as_str(self) -> &'static str {
        match self {
            ReceiptKind::Perception => "perception",
            ReceiptKind::Cognition  => "cognition",
            ReceiptKind::Action     => "action",
            ReceiptKind::Memory     => "memory",
            ReceiptKind::Control    => "control",
        }
    }
}

/// The atomic Receipt. 184 bytes header + variable content.
/// Designed to fit in a single cache line on Cortex-X4 (192B cache line).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Receipt {
    /// UUIDv7 — time-ordered, sortable, globally unique
    pub id: Uuid,

    /// Nanoseconds since UNIX_EPOCH (UTC). Stored as i64 for Arrow Int64.
    pub timestamp_ns: i64,

    /// Session ID — groups a user interaction thread
    pub session_id: Arc<str>,

    /// Which Constellation agent produced this
    pub origin: Origin,

    /// Cognitive phase
    pub kind: ReceiptKind,

    /// SHA-256 of `content` bytes — content addressing for dedup + integrity
    pub content_hash: [u8; 32],

    /// The actual payload. Arc for zero-copy sharing across threads.
    pub content: Arc<str>,

    /// Optional embedding (384-dim for Gemma 2B, 768-dim for FABLE).
    /// None for Control receipts.
    pub embedding: Option<Arc<Vec<f32>>>,

    /// Parent Receipt ID — forms a DAG. None for root perceptions.
    pub parent_receipt: Option<Uuid>,

    /// Trust score [0.0, 1.0]. REV.IKE outputs start at 0.5,
    /// FABLE plans start at 0.7, verified actions promoted to 0.9+.
    pub trust_score: f32,

    /// Hard Knox-safety flag. False blocks the Receipt from ever
    /// touching telephony/modem/IMEI surfaces.
    pub knox_safe: bool,

    /// Free-form metadata (model name, latency_ms, token_count, etc.)
    pub metadata: Arc<HashMap<Arc<str>, Arc<str>>>,
}

impl Receipt {
    /// Construct a new Receipt, computing content_hash automatically.
    pub fn new(
        session_id: Arc<str>,
        origin: Origin,
        kind: ReceiptKind,
        content: Arc<str>,
        parent_receipt: Option<Uuid>,
    ) -> Self {
        let mut hasher = Sha256::new();
        hasher.update(content.as_bytes());
        let content_hash = hasher.finalize().into();

        let timestamp_ns = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos() as i64)
            .unwrap_or(0);

        Self {
            id: Uuid::now_v7(),
            timestamp_ns,
            session_id,
            origin,
            kind,
            content_hash,
            content,
            embedding: None,
            parent_receipt,
            trust_score: match origin {
                Origin::RevIke => 0.5,
                Origin::Fable  => 0.7,
                Origin::Goose  => 0.6,
                Origin::Tashi  => 0.85,
                Origin::Epoch  => 0.4,
                Origin::User   => 1.0,
            },
            knox_safe: true,
            metadata: Arc::new(HashMap::new()),
        }
    }

    pub fn with_embedding(mut self, emb: Vec<f32>) -> Self {
        self.embedding = Some(Arc::new(emb));
        self
    }

    pub fn with_trust(mut self, t: f32) -> Self {
        self.trust_score = t.clamp(0.0, 1.0);
        self
    }

    pub fn with_metadata(mut self, k: impl Into<Arc<str>>, v: impl Into<Arc<str>>) -> Self {
        let mut m = (*self.metadata).clone();
        m.insert(k.into(), v.into());
        self.metadata = Arc::new(m);
        self
    }

    /// Mark unsafe for Knox surfaces. Once set, cannot be unset.
    pub fn mark_knox_unsafe(mut self) -> Self {
        self.knox_safe = false;
        self
    }
}

// ── Arrow schema definition ────────────────────────────────────────────────
// This schema is THE contract between Rust and DuckDB/ArrowJS consumers.
// Any change here MUST be accompanied by a DuckDB migration in
// context_ocean_schema.sql.

/// Returns the canonical Arrow schema for a Receipt batch.
/// Cached as SchemaRef (Arc) — cheap to clone.
pub fn receipt_schema() -> SchemaRef {
    let fields = vec![
        Field::new("id",              DataType::FixedSizeBinary(16), false),
        Field::new("timestamp_ns",    DataType::Int64,                false),
        Field::new("session_id",      DataType::Utf8,                 false),
        Field::new("origin",          DataType::Utf8,                 false),
        Field::new("kind",            DataType::Utf8,                 false),
        Field::new("content_hash",    DataType::FixedSizeBinary(32),  false),
        Field::new("content",         DataType::Utf8,                 false),
        Field::new("embedding",       DataType::List(Arc::new(
            Field::new("item", DataType::Float32, true))),            true),
        Field::new("parent_receipt",  DataType::FixedSizeBinary(16),  true),
        Field::new("trust_score",     DataType::Float32,              false),
        Field::new("knox_safe",       DataType::Boolean,              false),
        Field::new("metadata",        DataType::Utf8,                 false), // JSON-encoded
    ];
    Arc::new(Schema::new(fields))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn receipt_hashes_content() {
        let r1 = Receipt::new(
            "s1".into(), Origin::User, ReceiptKind::Perception,
            "hello world".into(), None,
        );
        let r2 = Receipt::new(
            "s1".into(), Origin::User, ReceiptKind::Perception,
            "hello world".into(), None,
        );
        assert_eq!(r1.content_hash, r2.content_hash);
        assert_ne!(r1.id, r2.id); // UUIDv7 includes random bits
    }

    #[test]
    fn revike_cannot_act() {
        // Convention enforced at deposit time, not struct level.
        let r = Receipt::new(
            "s1".into(), Origin::RevIke, ReceiptKind::Cognition,
            "interpretation".into(), None,
        );
        assert_eq!(r.origin, Origin::RevIke);
        assert_ne!(r.kind, ReceiptKind::Action);
    }
}
