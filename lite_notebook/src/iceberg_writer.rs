//! Iceberg Writer — commits Arrow RecordBatches to an Iceberg table
//! stored on-device as Parquet + manifest files.
//!
//! Path layout (under /data/local/tmp/ava007/context_ocean/):
//!   context_ocean/
//!   ├── metadata/
//!   │   ├── v1.metadata.json
//!   │   ├── v2.metadata.json        ← each commit = new version
//!   │   └── snap-<uuid>-<ts>.avro    ← manifest list (per snapshot)
//!   └── data/
//!       ├── 00000-<uuid>-0.parquet
//!       ├── 00001-<uuid>-0.parquet
//!       └── ...
//!
//! DuckDB-WASM reads the metadata.json + Parquet files directly
//! (no server round-trip — zero-copy shared memory on s25runtime).

use std::path::{Path, PathBuf};
use std::sync::Arc;

use arrow::record_batch::RecordBatch;
use parquet::{
    arrow::ArrowWriter,
    file::properties::WriterProperties,
};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::arrow_codec::ReceiptCodec;
use crate::receipt::Receipt;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IcebergSnapshot {
    pub snapshot_id: Uuid,
    pub parent_snapshot_id: Option<Uuid>,
    pub timestamp_ms: i64,
    pub manifest_list_path: String,
    pub summary: SnapshotSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SnapshotSummary {
    pub added_data_files: u32,
    pub added_records: u64,
    pub total_data_files: u32,
    pub total_records: u64,
    pub added_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DataFileManifest {
    pub data_file_path: String,
    pub record_count: u64,
    pub file_size_bytes: u64,
    pub lower_bound_ts_ns: i64,
    pub upper_bound_ts_ns: i64,
    pub content_hash_min: String, // hex of first receipt hash
    pub content_hash_max: String, // hex of last receipt hash
}

pub struct IcebergWriter {
    table_root: PathBuf,
    metadata_dir: PathBuf,
    data_dir: PathBuf,
    state: Mutex<IcebergState>,
}

struct IcebergState {
    current_snapshot: Option<Arc<IcebergSnapshot>>,
    manifests: Vec<DataFileManifest>,
    table_uuid: Uuid,
}

impl IcebergWriter {
    pub fn open(table_root: &Path) -> anyhow::Result<Arc<Self>> {
        let metadata_dir = table_root.join("metadata");
        let data_dir = table_root.join("data");
        std::fs::create_dir_all(&metadata_dir)?;
        std::fs::create_dir_all(&data_dir)?;

        // Look for an existing metadata.json to restore state
        let state = load_latest_metadata(&metadata_dir)?;

        Ok(Arc::new(Self {
            table_root: table_root.to_path_buf(),
            metadata_dir,
            data_dir,
            state: Mutex::new(state),
        }))
    }

    /// Commit a batch of Receipts:
    ///   1. Encode → Arrow RecordBatch
    ///   2. Write → Parquet data file
    ///   3. Append → manifest entry
    ///   4. Write → new metadata.json + snapshot
    ///
    /// Atomic-ish: the metadata.json rename is the commit point. If we
    /// crash before that, the Parquet file is orphaned but unreferenced
    /// (DuckDB won't see it). A compaction pass can reclaim orphans.
    pub fn commit(&self, receipts: Vec<Receipt>) -> anyhow::Result<Arc<IcebergSnapshot>> {
        if receipts.is_empty() {
            return Ok(self.state.lock().current_snapshot.clone()
                .unwrap_or_else(|| Arc::new(IcebergSnapshot {
                    snapshot_id: Uuid::nil(),
                    parent_snapshot_id: None,
                    timestamp_ms: 0,
                    manifest_list_path: String::new(),
                    summary: SnapshotSummary::default(),
                })));
        }

        // 1. Encode → Arrow
        let batch = ReceiptCodec::encode(&receipts)?;
        let record_count = batch.num_rows() as u64;

        // 2. Write Parquet file
        let data_file_id = Uuid::now_v7();
        let data_file_name = format!(
            "{:05}-{}.parquet",
            self.state.lock().manifests.len(),
            data_file_id
        );
        let data_file_path = self.data_dir.join(&data_file_name);

        let props = WriterProperties::builder()
            .set_compression(parquet::basic::Compression::ZSTD(parquet::basic::ZstdLevel::try_new(ZSTD_LEVEL)?))
            .set_dictionary_enabled(true)
            .set_max_row_group_size(128)
            .build();

        let file = std::fs::File::create(&data_file_path)?;
        let file_size_bytes = {
            let mut writer = ArrowWriter::try_new(&file, batch.schema(), Some(props))?;
            writer.write(&batch)?;
            writer.close()?
        };
        let file_size_bytes = file.metadata()?.len();

        // 3. Build manifest entry with stats
        let lower_ts = receipts.iter().map(|r| r.timestamp_ns).min().unwrap_or(0);
        let upper_ts = receipts.iter().map(|r| r.timestamp_ns).max().unwrap_or(0);
        let hash_min = receipts.first().map(|r| hex::encode(r.content_hash)).unwrap_or_default();
        let hash_max = receipts.last().map(|r| hex::encode(r.content_hash)).unwrap_or_default();

        let manifest = DataFileManifest {
            data_file_path: data_file_name,
            record_count,
            file_size_bytes,
            lower_bound_ts_ns: lower_ts,
            upper_bound_ts_ns: upper_ts,
            content_hash_min: hash_min,
            content_hash_max: hash_max,
        };

        // 4. Update state + write new metadata
        let snapshot = {
            let mut state = self.state.lock();
            state.manifests.push(manifest.clone());

            let parent_id = state.current_snapshot.as_ref().map(|s| s.snapshot_id);
            let snapshot = Arc::new(IcebergSnapshot {
                snapshot_id: Uuid::now_v7(),
                parent_snapshot_id: parent_id,
                timestamp_ms: chrono::Utc::now().timestamp_millis(),
                manifest_list_path: format!("snap-{}.avro", Uuid::now_v7()),
                summary: SnapshotSummary {
                    added_data_files: 1,
                    added_records: record_count,
                    total_data_files: state.manifests.len() as u32,
                    total_records: state.manifests.iter().map(|m| m.record_count).sum(),
                    added_bytes: file_size_bytes,
                },
            });

            // Write new metadata file (version N+1)
            let version = state.manifests.len();
            let metadata_path = self.metadata_dir.join(format!("v{version}.metadata.json"));
            let table_meta = TableMetadata {
                table_uuid: state.table_uuid,
                location: self.table_root.to_string_lossy().into(),
                current_snapshot_id: snapshot.snapshot_id,
                snapshots: vec![snapshot.as_ref().clone()],
                manifests: state.manifests.clone(),
            };
            let json = serde_json::to_string_pretty(&table_meta)?;
            let tmp = metadata_path.with_extension("json.tmp");
            std::fs::write(&tmp, json)?;
            std::fs::rename(&tmp, &metadata_path)?; // ← atomic commit point

            // Update latest pointer
            let latest = self.metadata_dir.join("latest.json");
            std::fs::write(&latest, serde_json::to_string(&metadata_path)?)?;

            state.current_snapshot = Some(snapshot.clone());
            snapshot
        };

        tracing::info!(
            "Iceberg commit: snapshot={} records={} files={} bytes={}",
            snapshot.snapshot_id, record_count,
            snapshot.summary.total_data_files, file_size_bytes
        );

        Ok(snapshot)
    }

    /// List current data files — used by DuckDB to register the table.
    pub fn current_data_files(&self) -> Vec<PathBuf> {
        self.state.lock().manifests.iter()
            .map(|m| self.data_dir.join(&m.data_file_path))
            .collect()
    }

    pub fn current_snapshot(&self) -> Option<Arc<IcebergSnapshot>> {
        self.state.lock().current_snapshot.clone()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableMetadata {
    pub table_uuid: Uuid,
    pub location: String,
    pub current_snapshot_id: Uuid,
    pub snapshots: Vec<IcebergSnapshot>,
    pub manifests: Vec<DataFileManifest>,
}

const ZSTD_LEVEL: i32 = 3;

fn load_latest_metadata(metadata_dir: &Path) -> anyhow::Result<IcebergState> {
    let latest = metadata_dir.join("latest.json");
    if !latest.exists() {
        return Ok(IcebergState {
            current_snapshot: None,
            manifests: Vec::new(),
            table_uuid: Uuid::now_v7(),
        });
    }

    let metadata_path: String = std::fs::read_to_string(&latest)?;
    let metadata_path: PathBuf = serde_json::from_str(&metadata_path)?;
    if !metadata_path.exists() {
        return Ok(IcebergState {
            current_snapshot: None,
            manifests: Vec::new(),
            table_uuid: Uuid::now_v7(),
        });
    }

    let json = std::fs::read_to_string(&metadata_path)?;
    let table_meta: TableMetadata = serde_json::from_str(&json)?;

    let current = table_meta.snapshots.iter()
        .find(|s| s.snapshot_id == table_meta.current_snapshot_id)
        .cloned()
        .map(Arc::new);

    Ok(IcebergState {
        current_snapshot: current,
        manifests: table_meta.manifests,
        table_uuid: table_meta.table_uuid,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::receipt::{Origin, ReceiptKind};
    use tempfile::tempdir;

    #[test]
    fn commit_writes_parquet_and_metadata() {
        let dir = tempdir().unwrap();
        let table_root = dir.path().join("ocean");
        let writer = IcebergWriter::open(&table_root).unwrap();

        let receipts: Vec<Receipt> = (0..32).map(|i| {
            Receipt::new(
            format!("s{}", i % 4).into(),
                Origin::User,
                ReceiptKind::Perception,
                format!("content-{i}").into(),
                None,
            ).with_embedding(vec![0.1 * i as f32; 8])
        }).collect();

        let snap = writer.commit(receipts).unwrap();
        assert_eq!(snap.summary.added_records, 32);
        assert_eq!(snap.summary.total_data_files, 1);

        let files = writer.current_data_files();
        assert_eq!(files.len(), 1);
        assert!(files[0].exists());
        assert!(files[0].extension().unwrap() == "parquet");

        // Re-open — should restore state
        let writer2 = IcebergWriter::open(&table_root).unwrap();
        let snap2 = writer2.current_snapshot().unwrap();
        assert_eq!(snap2.snapshot_id, snap.snapshot_id);
        assert_eq!(writer2.current_data_files().len(), 1);
    }
}
