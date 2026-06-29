//! Lite Notebook — ephemeral in-memory buffer with threshold/time flush triggers.
//!
//! This is the **fast path** between perception and the Context Ocean.
//! Every Receipt lands here first, gets fsync'd to the WAL for durability,
//! then batches into Arrow RecordBatches on either:
//!   - Capacity threshold (FLUSH_THRESHOLD = 64 receipts)
//!   - Time threshold (FLUSH_INTERVAL_MS = 2000ms)
//!   - Explicit flush (e.g. session boundary, AVA007 idle)
//!
//! Backpressure: if the buffer hits NOTEBOOK_CAPACITY (1024) the deposit
//! call blocks (sync) or returns WouldBlock (async). This prevents
//! unbounded memory growth under burst load.

use std::collections::VecDeque;
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};

use parking_lot::{Mutex, RwLock};
use tokio::sync::{mpsc, Notify};

use crate::receipt::Receipt;
use crate::wal::Wal;

pub const NOTEBOOK_CAPACITY: usize = 1024;
pub const FLUSH_THRESHOLD: usize = 64;
pub const FLUSH_INTERVAL_MS: u64 = 2000;

/// Command sent to the flush loop (the Context Ocean consumer).
#[derive(Debug)]
pub struct FlushBatch {
    pub receipts: Vec<Receipt>,
    pub sequence: u64,
    pub flushed_at: Instant,
}

#[derive(Debug, Default, Clone, Copy)]
pub struct NotebookStats {
    pub received: u64,
    pub flushed: u64,
    pub dropped: u64,
    pub in_flight: usize,
    pub last_flush_ms: u64,
    pub bytes_pending: usize,
}

struct Inner {
    buffer: VecDeque<Receipt>,
    last_flush: Instant,
    sequence: u64,
}

pub struct LiteNotebook {
    inner: Mutex<Inner>,
    wal: Arc<Wal>,
    stats: RwLock<NotebookStats>,
    pub(crate) tx: mpsc::Sender<FlushBatch>,
    flush_notify: Notify,
    closed: Mutex<bool>,
}

impl LiteNotebook {
    /// Open a new Lite Notebook bound to a WAL path and a flush channel.
    /// The receiver side is consumed by `ContextOcean::deposit_loop`.
    pub fn open(
        wal_path: &Path,
        channel_capacity: usize,
    ) -> anyhow::Result<(Arc<Self>, mpsc::Receiver<FlushBatch>)> {
        let wal = Wal::open(wal_path)?;

        // Replay any pending receipts from a previous crash
        let pending = Wal::replay(wal_path)?;
        let initial_count = pending.len();

        let inner = Inner {
            buffer: pending.into_iter().collect(),
            last_flush: Instant::now(),
            sequence: 0,
        };

        let (tx, rx) = mpsc::channel(channel_capacity);

        let notebook = Arc::new(Self {
            inner: Mutex::new(inner),
            wal,
            stats: RwLock::new(NotebookStats {
                received: initial_count as u64,
                in_flight: initial_count,
                ..Default::default()
            }),
            tx,
            flush_notify: Notify::new(),
            closed: Mutex::new(false),
        });

        Ok((notebook, rx))
    }

    /// Deposit a single Receipt. Synchronous on the WAL write (μs-scale),
    /// then triggers an async flush if the buffer hits threshold.
    ///
    /// Returns WouldBlock if buffer is at capacity and the consumer has
    /// not drained. Callers should retry or shed load.
    pub fn deposit(&self, r: Receipt) -> anyhow::Result<()> {
        if *self.closed.lock() {
            anyhow::bail!("notebook closed");
        }

        // REV.IKE safety invariant: read-only agent cannot produce Actions.
        if r.origin == crate::receipt::Origin::RevIke
            && r.kind == crate::receipt::ReceiptKind::Action
        {
            anyhow::bail!("REV.IKE cannot produce Action receipts (read-only invariant)");
        }

        // 1. WAL append (durable)
        self.wal.append(&r)?;

        // 2. Buffer push + flush check
        let should_flush = {
            let mut inner = self.inner.lock();
            if inner.buffer.len() >= NOTEBOOK_CAPACITY {
                anyhow::bail!("WouldBlock: notebook at capacity");
            }
            inner.buffer.push_back(r);
            let elapsed = inner.last_flush.elapsed();
            inner.buffer.len() >= FLUSH_THRESHOLD
                || elapsed >= Duration::from_millis(FLUSH_INTERVAL_MS)
        };

        if should_flush {
            self.flush_notify.notify_one();
        }

        self.stats.write().received += 1;
        Ok(())
    }

    /// Force a flush regardless of thresholds. Used at session boundaries.
    pub async fn flush(&self) -> anyhow::Result<()> {
        self.flush_notify.notify_one();
        // Give the loop a tick to pick it up
        tokio::time::sleep(Duration::from_millis(5)).await;
        Ok(())
    }

    /// Drain the current buffer into a FlushBatch and send to consumer.
    /// Called by the deposit_loop task.
    pub(crate) fn drain_for_flush(&self) -> Option<FlushBatch> {
        let mut inner = self.inner.lock();
        if inner.buffer.is_empty() {
            return None;
        }

        let receipts: Vec<Receipt> = inner.buffer.drain(..).collect();
        inner.sequence += 1;
        inner.last_flush = Instant::now();
        let sequence = inner.sequence;

        let flushed_at = Instant::now();
        let count = receipts.len();

        // Drop the lock before sending
        drop(inner);

        let batch = FlushBatch {
            receipts,
            sequence,
            flushed_at,
        };

        // Update stats
        {
            let mut s = self.stats.write();
            s.flushed += count as u64;
            s.in_flight = 0;
            s.last_flush_ms = flushed_at.elapsed().as_millis() as u64;
            s.bytes_pending = 0;
        }

        Some(batch)
    }

    pub fn stats(&self) -> NotebookStats {
        *self.stats.read()
    }

    pub fn wal_path(&self) -> std::path::PathBuf {
        self.wal.path()
    }

    /// Mark WAL truncation point — Iceberg has committed the batch.
    pub(crate) fn ack_commit(&self, _sequence: u64) -> anyhow::Result<()> {
        self.wal.truncate()
    }

    pub fn close(&self) {
        *self.closed.lock() = true;
        self.flush_notify.notify_waiters();
    }
}

/// Background flush driver — wakes on notify OR every FLUSH_INTERVAL_MS.
/// Sends drained batches through `tx` to the Context Ocean consumer.
pub async fn run_flush_loop(
    notebook: Arc<LiteNotebook>,
    tx: mpsc::Sender<FlushBatch>,
) {
    let mut ticker = tokio::time::interval(Duration::from_millis(FLUSH_INTERVAL_MS));
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    loop {
        tokio::select! {
            _ = notebook.flush_notify.notified() => {
                if let Some(batch) = notebook.drain_for_flush() {
                    if tx.send(batch).await.is_err() {
                        tracing::error!("Context Ocean receiver dropped — shutting down flush loop");
                        break;
                    }
                }
            }
            _ = ticker.tick() => {
                if let Some(batch) = notebook.drain_for_flush() {
                    if tx.send(batch).await.is_err() {
                        break;
                    }
                }
            }
        }
    }

    notebook.close();
    tracing::info!("Lite Notebook flush loop exited");
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::receipt::{Origin, ReceiptKind};
    use tempfile::tempdir;

    #[tokio::test]
    async fn flush_triggers_on_threshold() {
        let dir = tempdir().unwrap();
        let (nb, mut rx) = LiteNotebook::open(
            &dir.path().join("nb.wal"),
            16,
        ).unwrap();

        for i in 0..FLUSH_THRESHOLD {
            let r = Receipt::new(
                "s1".into(),
                Origin::User,
                ReceiptKind::Perception,
                format!("msg {i}").into(),
                None,
            );
            nb.deposit(r).unwrap();
        }

        let nb2 = nb.clone();
        let handle = tokio::spawn(async move {
            run_flush_loop(nb2, nb.tx.clone()).await;
        });

        let batch = tokio::time::timeout(
            Duration::from_millis(500), rx.recv(),
        ).await.unwrap().unwrap();

        assert_eq!(batch.receipts.len(), FLUSH_THRESHOLD);
        assert_eq!(batch.sequence, 1);

        handle.abort();
    }

    #[test]
    fn revike_action_rejected() {
        let dir = tempdir().unwrap();
        let (nb, _rx) = LiteNotebook::open(
            &dir.path().join("nb2.wal"),
            4,
        ).unwrap();

        let r = Receipt::new(
            "s".into(),
            Origin::RevIke,
            ReceiptKind::Action,
            "forbidden".into(),
            None,
        );

        let err = nb.deposit(r).unwrap_err();
        assert!(err.to_string().contains("read-only invariant"));
    }
}
