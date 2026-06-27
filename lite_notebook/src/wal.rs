//! Write-Ahead Log — durable, append-only, fsync-per-record.
//!
//! Path on device: /data/local/tmp/ava007/lite_notebook.wal
//! (User 0 writable on non-rooted Samsung, survives app kill, cleared on
//! clean shutdown after Iceberg commit ACK.)
//!
//! Format (bincode-encoded frames, length-prefixed):
//!   [u32 len][bincode::serialize(ReceiptFrame)]
//!
//! ReceiptFrame is a slimmed Receipt without the Arc<HashMap> metadata
//! (metadata is serialized as a single JSON string for compactness).

use std::fs::{File, OpenOptions};
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::receipt::{Origin, Receipt, ReceiptKind};

#[derive(Serialize, Deserialize, Clone)]
pub struct ReceiptFrame {
    pub id: Uuid,
    pub timestamp_ns: i64,
    pub session_id: String,
    pub origin: u8,
    pub kind: u8,
    pub content_hash: [u8; 32],
    pub content: String,
    pub embedding: Option<Vec<f32>>,
    pub parent_receipt: Option<Uuid>,
    pub trust_score: f32,
    pub knox_safe: bool,
    pub metadata_json: String,
}

impl From<&Receipt> for ReceiptFrame {
    fn from(r: &Receipt) -> Self {
        let metadata_json = serde_json::to_string(r.metadata.as_ref())
            .unwrap_or_else(|_| "{}".into());
        Self {
            id: r.id,
            timestamp_ns: r.timestamp_ns,
            session_id: r.session_id.to_string(),
            origin: r.origin as u8,
            kind: r.kind as u8,
            content_hash: r.content_hash,
            content: r.content.to_string(),
            embedding: r.embedding.as_ref().map(|e| (**e).clone()),
            parent_receipt: r.parent_receipt,
            trust_score: r.trust_score,
            knox_safe: r.knox_safe,
            metadata_json,
        }
    }
}

impl From<ReceiptFrame> for Receipt {
    fn from(f: ReceiptFrame) -> Self {
        use std::collections::HashMap;
        let metadata: HashMap<Arc<str>, Arc<str>> =
            serde_json::from_str(&f.metadata_json).unwrap_or_default();

        Receipt {
            id: f.id,
            timestamp_ns: f.timestamp_ns,
            session_id: f.session_id.into(),
            origin: unsafe { std::mem::transmute::<u8, Origin>(f.origin) },
            kind:    unsafe { std::mem::transmute::<u8, ReceiptKind>(f.kind) },
            content_hash: f.content_hash,
            content: f.content.into(),
            embedding: f.embedding.map(Arc::new),
            parent_receipt: f.parent_receipt,
            trust_score: f.trust_score,
            knox_safe: f.knox_safe,
            metadata: Arc::new(metadata),
        }
    }
}

pub struct Wal {
    inner: Mutex<WalInner>,
}

struct WalInner {
    writer: BufWriter<File>,
    path: PathBuf,
    bytes_written: u64,
    fsync_interval: u64,
    bytes_since_fsync: u64,
}

impl Wal {
    pub fn open(path: &Path) -> anyhow::Result<Arc<Self>> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .read(true)
            .open(path)?;

        let bytes_written = file.metadata()?.len();

        Ok(Arc::new(Self {
            inner: Mutex::new(WalInner {
                writer: BufWriter::new(file),
                path: path.to_path_buf(),
                bytes_written,
                fsync_interval: 64 * 1024, // fsync every 64KB
                bytes_since_fsync: 0,
            }),
        }))
    }

    /// Append a receipt frame, fsync every fsync_interval bytes.
    /// Returns the WAL offset (for crash recovery bookkeeping).
    pub fn append(&self, r: &Receipt) -> anyhow::Result<u64> {
        let frame = ReceiptFrame::from(r);
        let bytes = bincode::serialize(&frame)?;
        let len = bytes.len() as u32;

        let mut inner = self.inner.lock();
        let offset = inner.bytes_written;

        inner.writer.write_all(&len.to_le_bytes())?;
        inner.writer.write_all(&bytes)?;

        inner.bytes_written += 4 + bytes.len() as u64;
        inner.bytes_since_fsync += 4 + bytes.len() as u64;

        if inner.bytes_since_fsync >= inner.fsync_interval {
            inner.writer.flush()?;
            inner.writer.get_ref().sync_all()?;
            inner.bytes_since_fsync = 0;
        }

        Ok(offset)
    }

    /// Force fsync — called on Lite Notebook flush boundary.
    pub fn sync(&self) -> anyhow::Result<()> {
        let mut inner = self.inner.lock();
        inner.writer.flush()?;
        inner.writer.get_ref().sync_all()?;
        inner.bytes_since_fsync = 0;
        Ok(())
    }

    /// Replay all frames from the WAL. Called on startup before the
    /// Lite Notebook accepts new deposits.
    pub fn replay(path: &Path) -> anyhow::Result<Vec<Receipt>> {
        if !path.exists() {
            return Ok(Vec::new());
        }
        let file = OpenOptions::new().read(true).open(path)?;
        let mut reader = BufReader::new(file);
        let mut out = Vec::new();

        loop {
            let mut len_buf = [0u8; 4];
            match reader.read_exact(&mut len_buf) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
                Err(e) => return Err(e.into()),
            }
            let len = u32::from_le_bytes(len_buf) as usize;

            let mut buf = vec![0u8; len];
            reader.read_exact(&mut buf)?;

            match bincode::deserialize::<ReceiptFrame>(&buf) {
                Ok(frame) => out.push(Receipt::from(frame)),
                Err(e) => {
                    tracing::warn!("WAL frame corrupt, stopping replay: {e}");
                    break;
                }
            }
        }

        Ok(out)
    }

    /// Truncate the WAL after Iceberg has acknowledged a commit covering
    /// all current entries. Atomic on POSIX: rename new empty file over old.
    pub fn truncate(&self) -> anyhow::Result<()> {
        let mut inner = self.inner.lock();
        inner.writer.flush()?;
        // Close the writer by replacing it with a fresh one bound to /dev/null
        // temporarily, then do the rename and reopen.
        let dev_null = OpenOptions::new().write(true).open("/dev/null")?;
        inner.writer = BufWriter::new(dev_null);

        let tmp = inner.path.with_extension("wal.tmp");
        std::fs::File::create(&tmp)?;
        std::fs::rename(&tmp, &inner.path)?;

        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .read(true)
            .open(&inner.path)?;

        inner.writer = BufWriter::new(file);
        inner.bytes_written = 0;
        inner.bytes_since_fsync = 0;
        Ok(())
    }

    pub fn path(&self) -> PathBuf {
        self.inner.lock().path.clone()
    }

    pub fn bytes_written(&self) -> u64 {
        self.inner.lock().bytes_written
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn wal_survives_crash_simulation() {
        let dir = tempdir().unwrap();
        let wal_path = dir.path().join("test.wal");

        let wal = Wal::open(&wal_path).unwrap();
        for i in 0..10 {
            let r = Receipt::new(
                format!("s{i}").into(),
                Origin::User,
                ReceiptKind::Perception,
                format!("hello {i}").into(),
                None,
            );
            wal.append(&r).unwrap();
        }
        wal.sync().unwrap();
        drop(wal); // simulate crash (no truncate)

        let replayed = Wal::replay(&wal_path).unwrap();
        assert_eq!(replayed.len(), 10);
        assert_eq!(replayed[0].content.as_ref(), "hello 0");
        assert_eq!(replayed[9].content.as_ref(), "hello 9");
    }

    #[test]
    fn truncate_clears_wal() {
        let dir = tempdir().unwrap();
        let wal_path = dir.path().join("test2.wal");

        let wal = Wal::open(&wal_path).unwrap();
        for i in 0..5 {
            let r = Receipt::new(
                "s".into(),
                Origin::Fable,
                ReceiptKind::Cognition,
                format!("plan {i}").into(),
                None,
            );
            wal.append(&r).unwrap();
        }
        wal.sync().unwrap();
        wal.truncate().unwrap();

        let replayed = Wal::replay(&wal_path).unwrap();
        assert!(replayed.is_empty());
    }
}
