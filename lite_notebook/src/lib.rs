//! AVA007 — Lite Notebook → Context Ocean deposit loop.
//!
//! This crate implements the **fast path** of AVA007's cognitive pipeline:
//! the journey of a Receipt from perception to immutable storage in the
//! Context Ocean, queryable by DuckDB-WASM (Open Notebook LM) and by
//! EPOCH (UI sandbox, ArrowJS consumer).
//!
//! # Architecture
//!
//! ```text
//!   Producer (REV.IKE / FABLE / GOOSE / TASHI / User)
//!            │
//!            │ deposit(Receipt)
//!            ▼
//!   ┌────────────────────────────────────────────┐
//!   │            Lite Notebook                   │
//!   │  ┌──────────────┐   ┌──────────────────┐   │
//!   │  │  Ring Buffer │ + │  WAL (fsync)     │   │
//!   │  │  1024 cap    │   │  /data/local/...  │   │
//!   │  └──────┬───────┘   └──────────────────┘   │
//!   │         │ threshold=64 OR time=2s          │
//!   └─────────┼──────────────────────────────────┘
//!             │ FlushBatch
//!             ▼
//!   ┌────────────────────────────────────────────┐
//!   │       Context Ocean deposit_loop           │
//!   │  ┌──────────────────────────────────────┐  │
//!   │  │ 1. Arrow encode (zero-copy)          │  │
//!   │  │ 2. Iceberg commit (Parquet + meta)   │  │
//!   │  │ 3. Broadcast to REV.IKE + UI         │  │
//!   │  │ 4. WAL truncate (durability ACK)     │  │
//!   │  └──────────────────────────────────────┘  │
//!   └────────────────────────────────────────────┘
//!             │
//!             ├──▶ DuckDB-WASM (Open Notebook LM queries)
//!             ├──▶ EPOCH ArrowJS sandbox (UI render)
//!             └──▶ REV.IKE (read-only interpretation)
//! ```
//!
//! # Knox Safety
//!
//! - No telephony/IMEI/modem surfaces touched anywhere in this crate.
//! - `Receipt::knox_safe` flag is hardcoded `true` at construction;
//!   only `mark_knox_unsafe()` (called by Goose action router) can flip it.
//! - REV.IKE is structurally forbidden from producing Action receipts
//!   (enforced at `LiteNotebook::deposit`).
//!
//! # No SDK Constraint
//!
//! Pure Rust + NDK r27. No QNN, no TensorFlow Lite, no MLKit. Uses only:
//!   - arrow-rs (columnar memory)
//!   - parquet (file format)
//!   - tokio (async runtime)
//!   - parking_lot (sync primitives)
//!   - duckdb-rs (optional, for in-process queries — separate feature)
//!
//! # Target
//!
//! Samsung Galaxy S25 Ultra (Snapdragon 8 Elite, 12GB RAM).
//! Pinned to A720 core (index 4) via `core_affinity` at startup.

pub mod receipt;
pub mod arrow_codec;
pub mod wal;
pub mod notebook;
pub mod iceberg_writer;
pub mod ocean;

pub use receipt::{Origin, Receipt, ReceiptKind, receipt_schema};
pub use arrow_codec::ReceiptCodec;
pub use wal::Wal;
pub use notebook::{LiteNotebook, NotebookStats, FlushBatch, run_flush_loop,
                   NOTEBOOK_CAPACITY, FLUSH_THRESHOLD, FLUSH_INTERVAL_MS};
pub use iceberg_writer::{IcebergWriter, IcebergSnapshot, TableMetadata, DataFileManifest};
pub use ocean::{ContextOcean, OceanConfig};
