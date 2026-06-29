use crate::processor::*;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{info, warn};

// ─────────────────────────────────────────────
//  Processor Registry
//  Manages active processors, candidates, history.
//  Thread-safe for concurrent access.
// ─────────────────────────────────────────────

#[derive(Debug, Clone)]
pub enum DeploymentStrategy {
    /// Replace immediately — no A/B test
    Immediate,
    /// A/B test with percentage of traffic
    ABTest {
        traffic_percentage: f64,
        duration_hours: u32,
    },
    /// Candidate available but not active (manual promotion only)
    Shadow,
}

#[derive(Debug)]
pub struct CandidateProcessor {
    pub config: ProcessorConfig,
    pub deployment: DeploymentStrategy,
    pub traffic_served: u64,
    pub successes: u64,
    pub failures: u64,
    pub registered_at: i64,
}

pub struct ProcessorRegistry {
    /// Active processors — one per slot. This is the live harness.
    active: RwLock<HashMap<String, Arc<dyn HarnessProcessor>>>,

    /// Active processor configs (for serialization without locking the trait object)
    active_configs: RwLock<HashMap<String, ProcessorConfig>>,

    /// Candidate processors being A/B tested
    candidates: RwLock<HashMap<String, Vec<CandidateProcessor>>>,

    /// Historical versions (for rollback and evolution lineage)
    history: RwLock<HashMap<String, Vec<ProcessorConfig>>>,

    /// Random threshold for A/B routing (deterministic per request via hash)
    ab_salt: String,
}

impl std::fmt::Debug for ProcessorRegistry {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ProcessorRegistry")
            .field("ab_salt", &self.ab_salt)
            .finish()
    }
}

impl Default for ProcessorRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl ProcessorRegistry {
    pub fn new() -> Self {
        Self {
            active: RwLock::new(HashMap::new()),
            active_configs: RwLock::new(HashMap::new()),
            candidates: RwLock::new(HashMap::new()),
            history: RwLock::new(HashMap::new()),
            ab_salt: uuid::Uuid::new_v4().to_string(),
        }
    }

    // ─── Registration ───

    /// Register a processor as the active implementation for its slot.
    /// Previous active version is moved to history.
    pub async fn register_active(&self, processor: Arc<dyn HarnessProcessor>) {
        let slot = processor.slot().to_string();
        let config = processor.config_snapshot();

        // Archive current active to history
        {
            let active_configs = self.active_configs.read().await;
            if let Some(current_config) = active_configs.get(&slot) {
                let mut history = self.history.write().await;
                history
                    .entry(slot.clone())
                    .or_insert_with(Vec::new)
                    .push(current_config.clone());
                info!(
                    "Archived processor '{}' v{} to history",
                    slot, current_config.version
                );
            }
        }

        // Set new active
        {
            let mut active = self.active.write().await;
            active.insert(slot.clone(), processor);
        }
        {
            let mut active_configs = self.active_configs.write().await;
            active_configs.insert(slot.clone(), config);
        }

        info!("Registered active processor '{}' v{}", slot, {
            let configs = self.active_configs.read().await;
            configs.get(&slot).map(|c| c.version).unwrap_or(0)
        });
    }

    /// Register a candidate processor for A/B testing.
    pub async fn register_candidate(
        &self,
        slot: &str,
        config: ProcessorConfig,
        deployment: DeploymentStrategy,
    ) {
        let candidate = CandidateProcessor {
            config,
            deployment,
            traffic_served: 0,
            successes: 0,
            failures: 0,
            registered_at: chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0),
        };

        let mut candidates = self.candidates.write().await;
        candidates
            .entry(slot.to_string())
            .or_insert_with(Vec::new)
            .push(candidate);

        info!(
            "Registered candidate for slot '{}' ({} total candidates)",
            slot,
            candidates.get(slot).map(|v| v.len()).unwrap_or(0)
        );
    }

    // ─── Retrieval ───

    /// Get the active processor for a slot.
    pub async fn get_active(&self, slot: &str) -> Option<Arc<dyn HarnessProcessor>> {
        let active = self.active.read().await;
        active.get(slot).cloned()
    }

    /// Get the active config for a slot (serializable, no trait object).
    pub async fn get_active_config(&self, slot: &str) -> Option<ProcessorConfig> {
        let configs = self.active_configs.read().await;
        configs.get(slot).cloned()
    }

    /// Get all active configs (for serialization / sync to mobile).
    pub async fn all_active_configs(&self) -> HashMap<String, ProcessorConfig> {
        let configs = self.active_configs.read().await;
        configs.clone()
    }

    /// Get candidates for a slot.
    pub async fn get_candidates(&self, slot: &str) -> Vec<CandidateProcessor> {
        let candidates = self.candidates.read().await;
        candidates.get(slot).cloned().unwrap_or_default()
    }

    /// Get history for a slot.
    pub async fn get_history(&self, slot: &str) -> Vec<ProcessorConfig> {
        let history = self.history.read().await;
        history.get(slot).cloned().unwrap_or_default()
    }

    // ─── A/B Routing ───

    /// Decide whether a request should use the candidate or the active processor.
    /// Deterministic per request ID (same request always gets same assignment).
    pub async fn route_request(
        &self,
        slot: &str,
        request_id: &str,
    ) -> ProcessorRoute {
        let candidates = self.candidates.read().await;

        if let Some(slot_candidates) = candidates.get(slot) {
            for candidate in slot_candidates {
                match &candidate.deployment {
                    DeploymentStrategy::Immediate => {
                        warn!("Immediate candidate still in candidates pool for '{}'", slot);
                        continue;
                    }
                    DeploymentStrategy::ABTest { traffic_percentage, duration_hours } => {
                        let age_hours = (chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0)
                            - candidate.registered_at)
                            / 3_600_000_000_000; // nanos per hour

                        if age_hours > *duration_hours as i64 {
                            continue; // Expired
                        }

                        let hash = self.hash_for_routing(request_id, slot, candidate.config.version);
                        if hash < *traffic_percentage {
                            return ProcessorRoute::Candidate(candidate.config.clone());
                        }
                    }
                    DeploymentStrategy::Shadow => {
                        continue;
                    }
                }
            }
        }

        ProcessorRoute::Active
    }

    fn hash_for_routing(&self, request_id: &str, slot: &str, version: u32) -> f64 {
        use sha2::{Sha256, Digest};
        let input = format!("{}:{}:{}:{}", self.ab_salt, request_id, slot, version);
        let hash = Sha256::digest(input.as_bytes());
        let first_bytes = u64::from_be_bytes(hash[..8].try_into().unwrap_or([0; 8]));
        first_bytes as f64 / u64::MAX as f64
    }

    // ─── Promotion / Rollback ───

    /// Promote a candidate to active.
    pub async fn promote_candidate(&self, slot: &str, candidate_index: usize) {
        let mut candidates = self.candidates.write().await;
        if let Some(slot_candidates) = candidates.get_mut(slot) {
            if candidate_index < slot_candidates.len() {
                let candidate = slot_candidates.remove(candidate_index);
                info!(
                    "Promoted candidate v{} for slot '{}' to active",
                    candidate.config.version, slot
                );
                drop(candidates);
                // Caller must also register the actual processor object via register_active()
            }
        }
    }

    /// Remove a candidate (rejection).
    pub async fn remove_candidate(&self, slot: &str, candidate_index: usize) {
        let mut candidates = self.candidates.write().await;
        if let Some(slot_candidates) = candidates.get_mut(slot) {
            if candidate_index < slot_candidates.len() {
                let removed = slot_candidates.remove(candidate_index);
                info!(
                    "Removed candidate v{} for slot '{}'",
                    removed.config.version, slot
                );
            }
        }
    }

    /// Rollback a slot to its previous version.
    pub async fn rollback(&self, slot: &str) -> Option<ProcessorConfig> {
        let mut history = self.history.write().await;
        if let Some(slot_history) = history.get_mut(slot) {
            if let Some(previous) = slot_history.pop() {
                info!(
                    "Rolling back slot '{}' to v{}",
                    slot, previous.version
                );
                return Some(previous);
            }
        }
        warn!("No history available for rollback on slot '{}'", slot);
        None
    }

    /// Record a successful/failed invocation for a processor version.
    /// Used by the Critic and MetricsStore.
    pub async fn record_outcome(&self, slot: &str, version: u32, success: bool) {
        // Update active config if it matches
        {
            let mut configs = self.active_configs.write().await;
            if let Some(config) = configs.get_mut(slot) {
                if config.version == version {
                    config.total_invocations += 1;
                    let n = config.total_invocations as f64;
                    let current = config.performance_score;
                    let outcome = if success { 1.0 } else { 0.0 };
                    // Exponential moving average (alpha = 0.05)
                    config.performance_score = current * (1.0 - 1.0 / n.max(1.0).min(20.0)) + outcome * (1.0 / n.max(1.0).min(20.0));
                    // Simpler EMA: alpha = 0.05 fixed
                    config.performance_score = current * 0.95 + outcome * 0.05;
                }
            }
        }

        // Update candidate if it matches
        {
            let mut candidates = self.candidates.write().await;
            if let Some(slot_candidates) = candidates.get_mut(slot) {
                for candidate in slot_candidates.iter_mut() {
                    if candidate.config.version == version {
                        candidate.traffic_served += 1;
                        if success {
                            candidate.successes += 1;
                        } else {
                            candidate.failures += 1;
                        }
                        // Also update candidate's EMA performance score
                        let outcome = if success { 1.0 } else { 0.0 };
                        candidate.config.performance_score =
                            candidate.config.performance_score * 0.95 + outcome * 0.05;
                        candidate.config.total_invocations += 1;
                    }
                }
            }
        }
    }

    /// Snapshot the entire registry state for persistence to Context Ocean.
    pub async fn snapshot(&self) -> RegistrySnapshot {
        let active_configs = self.active_configs.read().await;
        let candidates = self.candidates.read().await;
        let history = self.history.read().await;

        RegistrySnapshot {
            active: active_configs.clone(),
            candidates: candidates.iter().map(|(k, v)| {
                (k.clone(), v.iter().map(|c| CandidateSnapshot {
                    config: c.config.clone(),
                    deployment: format!("{:?}", c.deployment),
                    traffic_served: c.traffic_served,
                    successes: c.successes,
                    failures: c.failures,
                    registered_at: c.registered_at,
                }).collect())
            }).collect(),
            history: history.clone(),
            ab_salt: self.ab_salt.clone(),
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RegistrySnapshot {
    pub active: HashMap<String, ProcessorConfig>,
    pub candidates: HashMap<String, Vec<CandidateSnapshot>>,
    pub history: HashMap<String, Vec<ProcessorConfig>>,
    pub ab_salt: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct CandidateSnapshot {
    pub config: ProcessorConfig,
    pub deployment: String,
    pub traffic_served: u64,
    pub successes: u64,
    pub failures: u64,
    pub registered_at: i64,
}

/// Routing decision for a single request.
#[derive(Debug, Clone)]
pub enum ProcessorRoute {
    /// Use the active processor
    Active,
    /// Use this candidate config (the processor object must be looked up separately)
    Candidate(ProcessorConfig),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn registry_starts_empty() {
        let reg = ProcessorRegistry::new();
        assert!(reg.get_active("classifier").await.is_none());
        assert!(reg.get_candidates("classifier").await.is_empty());
    }

    #[tokio::test]
    async fn record_outcome_updates_ema() {
        let reg = ProcessorRegistry::new();
        // Manually insert a config
        let mut cfg = ProcessorConfig::new("classifier", 1);
        cfg.total_invocations = 10;
        cfg.performance_score = 0.5;
        reg.active_configs.write().await.insert("classifier".into(), cfg);

        // Record 5 successes
        for _ in 0..5 {
            reg.record_outcome("classifier", 1, true).await;
        }

        let updated = reg.get_active_config("classifier").await.unwrap();
        assert!(updated.performance_score > 0.5);
        assert_eq!(updated.total_invocations, 15);
    }
}
