//! Metrics Store — persists per-invocation metrics for evolution decisions.
//!
//! Every time a processor is invoked, the Meta Harness calls
//! `metrics.record_invocation(...)` with the outcome. The store:
//!   - Persists to disk (JSONL format, append-only)
//!   - Computes aggregates on demand (success rate, latency percentiles)
//!   - Tracks calibration (does the processor's self-reported confidence
//!     correlate with actual success?)
//!
//! The Critic and Planner both read from this store.

use std::path::PathBuf;
use std::sync::Arc;

use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;
use tracing::warn;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InvocationRecord {
    pub id: String,
    pub timestamp_ns: i64,
    pub slot: String,
    pub processor_version: u32,
    pub session_id: String,
    pub request_id: String,
    /// Did the processor produce a successful output?
    pub success: bool,
    /// Self-reported confidence (0.0–1.0)
    pub confidence: f32,
    /// Tokens consumed
    pub tokens_used: u32,
    /// Wall-clock latency in ms
    pub latency_ms: u64,
    /// Whether this was an A/B test invocation (vs active)
    pub is_candidate: bool,
    /// Error message (if !success)
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProcessorMetrics {
    pub slot: String,
    pub version: u32,
    pub total_invocations: u64,
    pub successes: u64,
    pub failures: u64,
    pub avg_confidence: f32,
    /// Calibration: correlation between confidence and actual success.
    /// 1.0 = perfectly calibrated, 0.0 = no correlation, -1.0 = anti-correlated.
    pub calibration: f32,
    pub p50_latency_ms: u64,
    pub p95_latency_ms: u64,
    pub p99_latency_ms: u64,
    pub avg_tokens: u32,
}

pub struct MetricsStore {
    /// Path to the JSONL log file. Append-only.
    log_path: PathBuf,
    /// In-memory ring buffer of recent records (for fast queries)
    recent: RwLock<std::collections::VecDeque<InvocationRecord>>,
    /// Max records to keep in memory
    recent_capacity: usize,
}

impl MetricsStore {
    pub fn new(log_path: PathBuf, recent_capacity: usize) -> Arc<Self> {
        Arc::new(Self {
            log_path,
            recent: RwLock::new(std::collections::VecDeque::with_capacity(recent_capacity)),
            recent_capacity,
        })
    }

    /// Default path: /data/local/tmp/ava007/metrics.jsonl
    pub fn default_for_device() -> Arc<Self> {
        Self::new(
            PathBuf::from("/data/local/tmp/ava007/metrics.jsonl"),
            10_000,
        )
    }

    /// Record a single invocation. Persists to disk + in-memory ring buffer.
    pub async fn record_invocation(&self, record: InvocationRecord) -> anyhow::Result<()> {
        // Append to in-memory ring buffer
        {
            let mut recent = self.recent.write();
            if recent.len() >= self.recent_capacity {
                recent.pop_front();
            }
            recent.push_back(record.clone());
        }

        // Append to JSONL file (async, non-blocking on the hot path)
        let line = serde_json::to_string(&record)
            .map_err(|e| anyhow::anyhow!("serialize invocation: {e}"))?;
        let line = line + "\n";

        let path = self.log_path.clone();
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
            file.flush()?;
            Ok(())
        }).await??;

        Ok(())
    }

    /// Query metrics for a specific slot + version.
    pub fn metrics_for(&self, slot: &str, version: u32) -> ProcessorMetrics {
        let recent = self.recent.read();
        let filtered: Vec<&InvocationRecord> = recent.iter()
            .filter(|r| r.slot == slot && r.processor_version == version)
            .collect();

        self.compute_metrics(slot, version, &filtered)
    }

    /// Query metrics for all versions of a slot.
    pub fn metrics_for_slot(&self, slot: &str) -> Vec<ProcessorMetrics> {
        let recent = self.recent.read();
        let mut versions: std::collections::HashMap<u32, Vec<&InvocationRecord>> =
            std::collections::HashMap::new();
        for r in recent.iter().filter(|r| r.slot == slot) {
            versions.entry(r.processor_version).or_default().push(r);
        }

        versions.into_iter()
            .map(|(version, records)| self.compute_metrics(slot, version, &records))
            .collect()
    }

    /// Get recent invocations for a slot (most recent first).
    pub fn recent_for_slot(&self, slot: &str, limit: usize) -> Vec<InvocationRecord> {
        let recent = self.recent.read();
        recent.iter()
            .filter(|r| r.slot == slot)
            .take(limit)
            .cloned()
            .collect()
    }

    fn compute_metrics(
        &self,
        slot: &str,
        version: u32,
        records: &[&InvocationRecord],
    ) -> ProcessorMetrics {
        if records.is_empty() {
            return ProcessorMetrics {
                slot: slot.to_string(),
                version,
                ..Default::default()
            };
        }

        let n = records.len() as u64;
        let successes = records.iter().filter(|r| r.success).count() as u64;
        let failures = n - successes;

        let avg_confidence = records.iter().map(|r| r.confidence).sum::<f32>() / n as f32;
        let avg_tokens = records.iter().map(|r| r.tokens_used).sum::<u32>() / n as u32;

        // Latency percentiles
        let mut latencies: Vec<u64> = records.iter().map(|r| r.latency_ms).collect();
        latencies.sort_unstable();
        let p50 = percentile(&latencies, 50);
        let p95 = percentile(&latencies, 95);
        let p99 = percentile(&latencies, 99);

        // Calibration: Pearson correlation between confidence and success (0/1)
        let calibration = pearson_correlation(
            &records.iter().map(|r| r.confidence as f64).collect::<Vec<_>>(),
            &records.iter().map(|r| if r.success { 1.0 } else { 0.0 }).collect::<Vec<_>>(),
        ) as f32;

        ProcessorMetrics {
            slot: slot.to_string(),
            version,
            total_invocations: n,
            successes,
            failures,
            avg_confidence,
            calibration,
            p50_latency_ms: p50,
            p95_latency_ms: p95,
            p99_latency_ms: p99,
            avg_tokens,
        }
    }

    /// Total invocations across all slots/versions
    pub fn total_invocations(&self) -> u64 {
        self.recent.read().len() as u64
    }
}

fn percentile(sorted: &[u64], p: u8) -> u64 {
    if sorted.is_empty() {
        return 0;
    }
    let idx = ((p as f64 / 100.0) * (sorted.len() as f64 - 1.0)).round() as usize;
    sorted[idx.min(sorted.len() - 1)]
}

fn pearson_correlation(x: &[f64], y: &[f64]) -> f64 {
    let n = x.len() as f64;
    if n == 0.0 {
        return 0.0;
    }
    let mean_x = x.iter().sum::<f64>() / n;
    let mean_y = y.iter().sum::<f64>() / n;

    let mut num = 0.0;
    let mut den_x = 0.0;
    let mut den_y = 0.0;
    for (xi, yi) in x.iter().zip(y.iter()) {
        let dx = xi - mean_x;
        let dy = yi - mean_y;
        num += dx * dy;
        den_x += dx * dx;
        den_y += dy * dy;
    }

    let denom = den_x.sqrt() * den_y.sqrt();
    if denom < 1e-9 {
        0.0
    } else {
        num / denom
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn record_and_query_metrics() {
        let dir = tempfile::tempdir().unwrap();
        let store = MetricsStore::new(dir.path().join("metrics.jsonl"), 1000);

        // Record 10 invocations: 7 successes, 3 failures
        for i in 0..10 {
            let success = i < 7;
            let record = InvocationRecord {
                id: format!("inv-{i}"),
                timestamp_ns: i as i64,
                slot: "classifier".into(),
                processor_version: 1,
                session_id: "s1".into(),
                request_id: format!("req-{i}"),
                success,
                confidence: if success { 0.85 } else { 0.3 },
                tokens_used: 20,
                latency_ms: 100 + i as u64 * 10,
                is_candidate: false,
                error: if success { None } else { Some("low confidence".into()) },
            };
            store.record_invocation(record).await.unwrap();
        }

        let metrics = store.metrics_for("classifier", 1);
        assert_eq!(metrics.total_invocations, 10);
        assert_eq!(metrics.successes, 7);
        assert_eq!(metrics.failures, 3);
        assert!((metrics.avg_confidence - 0.685).abs() < 0.01);
        assert!(metrics.p50_latency_ms > 0);
        assert!(metrics.p95_latency_ms >= metrics.p50_latency_ms);
        // Calibration should be positive (high confidence → success)
        assert!(metrics.calibration > 0.0);
    }

    #[test]
    fn percentile_handles_edge_cases() {
        assert_eq!(percentile(&[], 50), 0);
        assert_eq!(percentile(&[100], 50), 100);
        assert_eq!(percentile(&[10, 20, 30, 40, 50], 50), 30);
        assert_eq!(percentile(&[10, 20, 30, 40, 50], 95), 50);
    }

    #[test]
    fn pearson_correlation_detects_positive_correlation() {
        let x = vec![0.1, 0.3, 0.5, 0.7, 0.9];
        let y = vec![0.0, 0.0, 1.0, 1.0, 1.0];
        let r = pearson_correlation(&x, &y);
        assert!(r > 0.8); // Strong positive correlation
    }
}
