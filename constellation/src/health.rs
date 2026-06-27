//! Model health — runtime health tracking per model.

use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tracing::warn;

use crate::model::ModelId;

/// Runtime health for a single model.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ModelHealth {
    /// Whether the model is currently available (loaded + responding)
    pub available: bool,
    /// Current load (0.0–1.0) — for local models, whether inference is in flight
    pub current_load: f32,
    /// Recent failure count (decays over time)
    pub recent_failures: u32,
    /// Last failure timestamp (epoch nanos)
    pub last_failure_ns: i64,
    /// Rolling average latency (ms)
    pub avg_latency_ms: u64,
    /// Rolling success rate (0.0–1.0)
    pub success_rate: f64,
}

/// Shared health registry — updated by the inference backend after each call.
#[derive(Debug, Clone)]
pub struct HealthRegistry {
    inner: Arc<RwLock<HashMap<ModelId, ModelHealth>>>,
    /// Failure window — failures older than this are decayed away
    failure_window: Duration,
    /// Max failures before a model is marked unavailable
    max_recent_failures: u32,
}

impl HealthRegistry {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(RwLock::new(HashMap::new())),
            failure_window: Duration::from_secs(300), // 5 min
            max_recent_failures: 5,
        }
    }

    pub fn get(&self, id: &ModelId) -> ModelHealth {
        self.inner.read().get(id).cloned().unwrap_or_default()
    }

    pub fn set_available(&self, id: &ModelId, available: bool) {
        let mut inner = self.inner.write();
        let entry = inner.entry(id.clone()).or_default();
        entry.available = available;
    }

    /// Record a successful inference call.
    pub fn record_success(&self, id: &ModelId, latency_ms: u64) {
        let mut inner = self.inner.write();
        let entry = inner.entry(id.clone()).or_default();
        entry.available = true;
        entry.success_rate = entry.success_rate * 0.95 + 1.0 * 0.05;
        entry.avg_latency_ms =
            (entry.avg_latency_ms as f64 * 0.8 + latency_ms as f64 * 0.2) as u64;
        // Decay failures
        if entry.recent_failures > 0 {
            entry.recent_failures = entry.recent_failures.saturating_sub(1);
        }
    }

    /// Record a failed inference call.
    pub fn record_failure(&self, id: &ModelId) {
        let now_ns = chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0);
        let mut inner = self.inner.write();
        let entry = inner.entry(id.clone()).or_default();
        entry.recent_failures += 1;
        entry.last_failure_ns = now_ns;
        entry.success_rate = entry.success_rate * 0.95;
        if entry.recent_failures >= self.max_recent_failures {
            entry.available = false;
            warn!(
                "Model {:?} marked unavailable after {} recent failures",
                id, entry.recent_failures
            );
        }
    }

    /// Decay stale failures (called periodically).
    pub fn decay(&self) {
        let now_ns = chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0);
        let cutoff_ns = now_ns - (self.failure_window.as_nanos() as i64);
        let mut inner = self.inner.write();
        for health in inner.values_mut() {
            if health.last_failure_ns > 0 && health.last_failure_ns < cutoff_ns {
                if health.recent_failures > 0 {
                    health.recent_failures -= 1;
                    health.last_failure_ns = if health.recent_failures > 0 { now_ns } else { 0 };
                }
                if health.recent_failures == 0 && !health.available {
                    health.available = true;
                }
            }
        }
    }

    pub fn snapshot(&self) -> HashMap<ModelId, ModelHealth> {
        self.inner.read().clone()
    }
}

impl Default for HealthRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn record_success_lifts_health() {
        let h = HealthRegistry::new();
        h.record_success(&ModelId::Gemma2B, 100);
        let snap = h.get(&ModelId::Gemma2B);
        assert!(snap.available);
        assert!(snap.success_rate > 0.0);
        assert!(snap.avg_latency_ms > 0);
    }

    #[test]
    fn record_failure_marks_unavailable_after_threshold() {
        let h = HealthRegistry::new();
        for _ in 0..5 {
            h.record_failure(&ModelId::Gemma2B);
        }
        let snap = h.get(&ModelId::Gemma2B);
        assert!(!snap.available);
        assert_eq!(snap.recent_failures, 5);
    }
}
