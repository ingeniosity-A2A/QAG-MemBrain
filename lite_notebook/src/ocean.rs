//! Context Ocean — the deposit loop coordinator.
//!
//! This is the single consumer of the Lite Notebook flush channel.
//! Its job:
//!   1. Receive FlushBatch from Lite Notebook
//!   2. Hand receipts to IcebergWriter (Parquet + manifest commit)
//!   3. On commit ACK, truncate the WAL
//!   4. Publish the new snapshot pointer to DuckDB / EPOCH subscribers
//!   5. Emit Receipts on the broadcast channel for REV.IKE (read-only)
//!      and any live UI subscribers
//!
//! Topology:
//!
//!   ┌──────────────┐    deposit()    ┌───────────────┐
//!   │  Producers   │ ───────────────▶│  LiteNotebook │
//!   │ (REV.IKE,    │                 │   (ring buf + │
//!   │  FABLE,      │                 │    WAL)       │
//!   │  GOOSE,      │                 └───────┬───────┘
//!   │  TASHI,      │                         │ FlushBatch
//!   │  User)       │                         ▼
//!   └──────────────┘                 ┌───────────────┐
//!                                    │  deposit_loop │
//!                                    │  (this file)  │
//!                                    └───────┬───────┘
//!                                            │
//!                            ┌───────────────┼───────────────┐
//!                            ▼               ▼               ▼
//!                      ┌──────────┐   ┌────────────┐  ┌──────────────┐
//!                      │ Iceberg  │   │  DuckDB    │  │  Broadcast   │
//!                      │  Writer  │   │  refresh   │  │  (REV.IKE +  │
//!                      │ (parquet)│   │ (view regen)│  │   UI subs)   │
//!                      └──────────┘   └────────────┘  └──────────────┘
//!
//! All paths are async. The deposit_loop runs on a dedicated Tokio task
//! pinned to a big.LITTLE.LITTLE core (snapdragon 8 Elite has 2× Oryon +
//! 7× A-series). Pin to core 4 (A720) via `core_affinity` crate at runtime.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use parking_lot::RwLock;
use tokio::sync::{broadcast, mpsc};
use tracing::{error, info, warn};

use crate::iceberg_writer::{IcebergSnapshot, IcebergWriter};
use crate::notebook::{run_flush_loop, FlushBatch, LiteNotebook, NotebookStats};
use crate::receipt::Receipt;

/// Configuration for the Context Ocean deposit loop.
#[derive(Clone, Debug)]
pub struct OceanConfig {
    /// Base path: typically /data/local/tmp/ava007/
    pub base_path: PathBuf,
    /// Channel capacity between Lite Notebook → deposit_loop
    pub flush_channel_capacity: usize,
    /// Broadcast channel capacity (REV.IKE + UI subscribers)
    pub broadcast_capacity: usize,
    /// Max retries on Iceberg commit failure before giving up
    pub max_commit_retries: u32,
}

impl Default for OceanConfig {
    fn default() -> Self {
        Self {
            base_path: PathBuf::from("/data/local/tmp/ava007"),
            flush_channel_capacity: 32,
            broadcast_capacity: 256,
            max_commit_retries: 3,
        }
    }
}

/// The Context Ocean handle. Cloneable, cheap (Arc internals).
#[derive(Clone)]
pub struct ContextOcean {
    pub notebook: Arc<LiteNotebook>,
    pub iceberg: Arc<IcebergWriter>,
    pub latest_snapshot: Arc<RwLock<Option<Arc<IcebergSnapshot>>>>,
    pub broadcast: broadcast::Sender<Receipt>,
    pub config: OceanConfig,
}

impl ContextOcean {
    /// Bootstrap the entire deposit pipeline.
    /// Returns the ocean handle + a JoinHandle for the deposit loop task.
    pub fn spawn(
        config: OceanConfig,
    ) -> anyhow::Result<(Self, tokio::task::JoinHandle<()>)> {
        let wal_path = config.base_path.join("lite_notebook.wal");
        let table_root = config.base_path.join("context_ocean");

        let (notebook, rx) = LiteNotebook::open(
            &wal_path,
            config.flush_channel_capacity,
        )?;

        let iceberg = IcebergWriter::open(&table_root)?;

        let (broadcast_tx, _) = broadcast::channel(config.broadcast_capacity);

        let ocean = Self {
            notebook: notebook.clone(),
            iceberg: iceberg.clone(),
            latest_snapshot: Arc::new(RwLock::new(iceberg.current_snapshot())),
            broadcast: broadcast_tx,
            config: config.clone(),
        };

        // Spawn the flush driver
        let nb_for_flush = notebook.clone();
        let tx_for_flush = notebook.tx.clone();
        let flush_handle = tokio::spawn(async move {
            run_flush_loop(nb_for_flush, tx_for_flush).await;
        });

        // Spawn the deposit loop (the actual Context Ocean consumer)
        let ocean_for_loop = ocean.clone();
        let deposit_handle = tokio::spawn(async move {
            deposit_loop(ocean_for_loop, rx).await;
        });

        // When the deposit loop exits, abort the flush driver
        let fh = flush_handle;
        tokio::spawn(async move {
            let _ = deposit_handle.await;
            fh.abort();
            info!("Context Ocean fully shut down");
        });

        // Return the deposit loop's join handle as the canonical "ocean task"
        // (the flush driver is internal — aborting it on deposit_loop exit is enough)
        // Actually return a no-op handle since we already chained shutdown above.
        // Caller can just hold the ocean handle.
        let join = tokio::spawn(async { /* see above */ });

        Ok((ocean, join))
    }

    /// Producer-side entry point. Used by REV.IKE, FABLE, GOOSE, etc.
    pub async fn deposit(&self, r: Receipt) -> anyhow::Result<()> {
        self.notebook.deposit(r)
    }

    /// Subscribe to the live Receipt stream.
    /// REV.IKE uses this as a read-only interpretation feed.
    /// EPOCH UI uses this for live updates.
    pub fn subscribe(&self) -> broadcast::Receiver<Receipt> {
        self.broadcast.subscribe()
    }

    pub fn stats(&self) -> NotebookStats {
        self.notebook.stats()
    }
}

/// The actual deposit loop. Owns the receiver end of the flush channel.
async fn deposit_loop(
    ocean: ContextOcean,
    mut rx: mpsc::Receiver<FlushBatch>,
) {
    info!("Context Ocean deposit loop started");

    while let Some(batch) = rx.recv().await {
        let receipts = batch.receipts.clone();
        let sequence = batch.sequence;

        // 1. Commit to Iceberg (with retry)
        let snapshot = match commit_with_retry(&ocean, batch.receipts, ocean.config.max_commit_retries) {
            Ok(s) => s,
            Err(e) => {
                error!("Iceberg commit failed (seq={sequence}): {e}. Receipts lost in flight — WAL still holds them for next start.");
                continue;
            }
        };

        // 2. Update latest snapshot pointer
        *ocean.latest_snapshot.write() = Some(snapshot.clone());

        // 3. Broadcast each receipt to live subscribers (REV.IKE, UI).
        //    These are non-blocking — if a subscriber is slow, it drops.
        for r in &receipts {
            let _ = ocean.broadcast.send(r.clone());
        }

        // 4. ACK the WAL truncation (Iceberg commit is durable)
        if let Err(e) = ocean.notebook.ack_commit(sequence) {
            warn!("WAL truncate failed (seq={sequence}): {e}. Will retry on next commit.");
        }

        info!(
            "Ocean commit OK: seq={} snapshot={} records={} total_files={} total_records={}",
            sequence,
            snapshot.snapshot_id,
            snapshot.summary.added_records,
            snapshot.summary.total_data_files,
            snapshot.summary.total_records
        );
    }

    info!("Context Ocean deposit loop exiting (channel closed)");
}

fn commit_with_retry(
    ocean: &ContextOcean,
    receipts: Vec<Receipt>,
    max_retries: u32,
) -> anyhow::Result<Arc<IcebergSnapshot>> {
    let mut attempt = 0;
    loop {
        attempt += 1;
        match ocean.iceberg.commit(receipts.clone()) {
            Ok(s) => return Ok(s),
            Err(e) if attempt <= max_retries => {
                warn!("Iceberg commit attempt {attempt} failed: {e}. Retrying...");
                std::thread::sleep(std::time::Duration::from_millis(50 * attempt as u64));
            }
            Err(e) => return Err(e),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::receipt::{Origin, ReceiptKind};

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn end_to_end_deposit_flow() {
        let dir = tempfile::tempdir().unwrap();
        let config = OceanConfig {
            base_path: dir.path().to_path_buf(),
            flush_channel_capacity: 8,
            broadcast_capacity: 128,  // large enough for the 65-receipt test
            max_commit_retries: 2,
        };

        let (ocean, _join) = ContextOcean::spawn(config).unwrap();

        // Subscribe to broadcast BEFORE depositing
        let mut sub = ocean.subscribe();

        // Deposit 65 receipts — should trigger threshold flush at 64
        for i in 0..65 {
            let r = Receipt::new(
                format!("sess-{}", i % 3).into(),
                Origin::User,
                ReceiptKind::Perception,
                format!("test content {i}").into(),
                None,
            ).with_embedding(vec![0.1 * i as f32; 4]);
            ocean.deposit(r).await.unwrap();
        }

        // Give the loop time to process
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;

        // Should have received at least 64 receipts on broadcast
        let mut received = 0;
        while let Ok(_) = sub.try_recv() {
            received += 1;
        }
        assert!(received >= 64, "expected >=64 broadcast receipts, got {received}");

        // Iceberg should have at least one snapshot
        let snap = ocean.latest_snapshot.read().clone();
        assert!(snap.is_some(), "no snapshot published");
        let snap = snap.unwrap();
        assert!(snap.summary.total_records >= 64);

        // Force final flush
        ocean.notebook.flush().await.unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;

        let stats = ocean.stats();
        assert!(stats.flushed >= 64);
    }
}
