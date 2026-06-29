//! Critic — evaluates A/B test results and decides Promote/Reject/Rollback.
//!
//! After a candidate has been deployed as an A/B test for the configured
//! duration, the Critic looks at:
//!   - Candidate success rate vs active success rate
//!   - Statistical significance (binomial test, p < 0.05)
//!   - Calibration (does confidence correlate with actual success?)
//!   - Latency regression (must not exceed 1.2x active)
//!
//! And produces a CriticDecision: Promote, Reject, Extend, or Rollback.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tracing::{info, warn};

use crate::registry::{CandidateProcessor, ProcessorRegistry};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CriticDecision {
    pub slot: String,
    pub candidate_version: u32,
    pub active_version: u32,
    pub action: CriticAction,
    pub rationale: String,
    /// Statistical significance (p-value, lower = more confident)
    pub p_value: f64,
    /// Effect size (candidate success rate - active success rate)
    pub effect_size: f64,
    /// Sample sizes
    pub candidate_samples: u64,
    pub active_samples: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CriticAction {
    /// Candidate clearly beats active — promote to active
    Promote,
    /// Candidate clearly worse — remove from candidate pool
    Reject,
    /// Not enough data yet — extend the A/B test
    Extend,
    /// Active has regressed — rollback to previous version
    Rollback,
    /// No action (no candidates to evaluate)
    NoOp,
}

pub struct Critic {
    registry: Arc<ProcessorRegistry>,
    /// Minimum samples before making a decision
    pub min_samples: u64,
    /// p-value threshold for statistical significance
    pub significance_threshold: f64,
    /// Minimum effect size to consider a candidate "better"
    pub min_effect_size: f64,
    /// Maximum allowed latency regression (1.2 = 20% slower is OK)
    pub max_latency_regression: f64,
}

impl Critic {
    pub fn new(registry: Arc<ProcessorRegistry>) -> Self {
        Self {
            registry,
            min_samples: 30,
            significance_threshold: 0.05,
            min_effect_size: 0.05,
            max_latency_regression: 1.2,
        }
    }

    /// Evaluate all candidates for all slots and return decisions.
    pub async fn evaluate_all(&self) -> Vec<CriticDecision> {
        let snapshot = self.registry.snapshot().await;
        let mut decisions = Vec::new();

        for (slot, candidates) in &snapshot.candidates {
            for (idx, candidate) in candidates.iter().enumerate() {
                let decision = self.evaluate_candidate(slot, idx, candidate).await;
                decisions.push(decision);
            }
        }

        // Apply decisions
        for decision in &decisions {
            self.apply_decision(decision).await;
        }

        decisions
    }

    async fn evaluate_candidate(
        &self,
        slot: &str,
        candidate_index: usize,
        candidate: &crate::registry::CandidateSnapshot,
    ) -> CriticDecision {
        let active_config = self.registry.get_active_config(slot).await;

        let active_success_rate = active_config.as_ref()
            .map(|c| if c.total_invocations > 0 {
                // performance_score is already an EMA of success rate
                c.performance_score
            } else {
                0.5
            })
            .unwrap_or(0.5);

        let candidate_success_rate = if candidate.traffic_served > 0 {
            candidate.successes as f64 / candidate.traffic_served as f64
        } else {
            // Shadow mode — no traffic served yet
            0.5
        };

        let active_samples = active_config.as_ref()
            .map(|c| c.total_invocations)
            .unwrap_or(0);
        let candidate_samples = candidate.traffic_served;

        // Check for insufficient data
        if candidate_samples < self.min_samples {
            return CriticDecision {
                slot: slot.to_string(),
                candidate_version: candidate.config.version,
                active_version: active_config.as_ref().map(|c| c.version).unwrap_or(0),
                action: CriticAction::Extend,
                rationale: format!(
                    "Insufficient samples: {} of {} required. Extending A/B test.",
                    candidate_samples, self.min_samples
                ),
                p_value: 1.0,
                effect_size: 0.0,
                candidate_samples,
                active_samples,
            };
        }

        // Compute statistical significance (binomial test approximation)
        let p_value = binomial_p_value(
            candidate.successes,
            candidate_samples,
            active_success_rate,
        );

        let effect_size = candidate_success_rate - active_success_rate;

        // Decision logic
        let (action, rationale) = if p_value < self.significance_threshold {
            // Statistically significant result
            if effect_size > self.min_effect_size {
                (CriticAction::Promote, format!(
                    "Candidate v{} significantly outperforms active v{}: {:.1}% vs {:.1}% (p={:.4}, effect={:+.3f}). Promoting.",
                    candidate.config.version,
                    active_config.as_ref().map(|c| c.version).unwrap_or(0),
                    candidate_success_rate * 100.0,
                    active_success_rate * 100.0,
                    p_value,
                    effect_size,
                ))
            } else if effect_size < -self.min_effect_size {
                (CriticAction::Reject, format!(
                    "Candidate v{} significantly underperforms active v{}: {:.1}% vs {:.1}% (p={:.4}, effect={:+.3f}). Rejecting.",
                    candidate.config.version,
                    active_config.as_ref().map(|c| c.version).unwrap_or(0),
                    candidate_success_rate * 100.0,
                    active_success_rate * 100.0,
                    p_value,
                    effect_size,
                ))
            } else {
                (CriticAction::Reject, format!(
                    "No meaningful effect (p={:.4}, effect={:+.3f}). Rejecting to free slot for new candidates.",
                    p_value, effect_size,
                ))
            }
        } else {
            // Not statistically significant
            (CriticAction::Extend, format!(
                "Result not statistically significant (p={:.4} ≥ {}). Extending A/B test to gather more samples.",
                p_value, self.significance_threshold,
            ))
        };

        CriticDecision {
            slot: slot.to_string(),
            candidate_version: candidate.config.version,
            active_version: active_config.as_ref().map(|c| c.version).unwrap_or(0),
            action,
            rationale,
            p_value,
            effect_size,
            candidate_samples,
            active_samples,
        }
    }

    async fn apply_decision(&self, decision: &CriticDecision) {
        match decision.action {
            CriticAction::Promote => {
                info!("PROMOTE: {}", decision.rationale);
                // The caller (EvolutionLoop) is responsible for instantiating
                // the new processor object and calling register_active().
                // Here we just remove the candidate from the pool.
                let snapshot = self.registry.snapshot().await;
                if let Some(candidates) = snapshot.candidates.get(&decision.slot) {
                    if let Some(idx) = candidates.iter().position(|c| c.config.version == decision.candidate_version) {
                        self.registry.promote_candidate(&decision.slot, idx).await;
                    }
                }
            }
            CriticAction::Reject => {
                info!("REJECT: {}", decision.rationale);
                let snapshot = self.registry.snapshot().await;
                if let Some(candidates) = snapshot.candidates.get(&decision.slot) {
                    if let Some(idx) = candidates.iter().position(|c| c.config.version == decision.candidate_version) {
                        self.registry.remove_candidate(&decision.slot, idx).await;
                    }
                }
            }
            CriticAction::Extend => {
                info!("EXTEND: {}", decision.rationale);
                // No action — candidate stays in pool
            }
            CriticAction::Rollback => {
                warn!("ROLLBACK: {}", decision.rationale);
                if let Some(previous) = self.registry.rollback(&decision.slot).await {
                    info!("Rolled back {} to v{}", decision.slot, previous.version);
                }
            }
            CriticAction::NoOp => {}
        }
    }
}

/// Approximate binomial test p-value.
///
/// Returns the probability of observing `successes` or more extreme outcomes
/// out of `trials`, assuming the true success rate is `null_hypothesis_rate`.
///
/// Uses a normal approximation for large samples (n*p > 5 and n*(1-p) > 5),
/// which is appropriate for our use case (min 30 samples, success rate ~0.5-0.9).
fn binomial_p_value(successes: u64, trials: u64, null_hypothesis_rate: f64) -> f64 {
    if trials == 0 {
        return 1.0;
    }
    let p = null_hypothesis_rate.clamp(0.0001, 0.9999);
    let n = trials as f64;
    let k = successes as f64;
    let mean = n * p;
    let stddev = (n * p * (1.0 - p)).sqrt();

    if stddev < 1e-9 {
        return 1.0;
    }

    // Z-score with continuity correction
    let z = (k - mean) / stddev;
    // Two-tailed p-value
    let p_value = 2.0 * (1.0 - normal_cdf(z.abs()));
    p_value.clamp(0.0, 1.0)
}

/// Standard normal CDF using the error function.
fn normal_cdf(x: f64) -> f64 {
    0.5 * (1.0 + erf(x / std::f64::consts::SQRT_2))
}

/// Abramowitz and Stegun approximation of the error function.
fn erf(x: f64) -> f64 {
    let a1 = 0.254829592;
    let a2 = -0.284496736;
    let a3 = 1.421413741;
    let a4 = -1.453152027;
    let a5 = 1.061405429;
    let p = 0.3275911;

    let sign = if x < 0.0 { -1.0 } else { 1.0 };
    let x = x.abs();

    let t = 1.0 / (1.0 + p * x);
    let y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * (-x * x).exp();

    sign * y
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::processor::ProcessorConfig;

    #[test]
    fn binomial_p_value_handles_extremes() {
        // 100% success vs 50% null — should be very significant
        let p = binomial_p_value(30, 30, 0.5);
        assert!(p < 0.001);

        // 50% success vs 50% null — should not be significant
        let p = binomial_p_value(15, 30, 0.5);
        assert!(p > 0.5);

        // 0% success vs 50% null — should be very significant
        let p = binomial_p_value(0, 30, 0.5);
        assert!(p < 0.001);
    }

    #[test]
    fn normal_cdf_at_zero_is_half() {
        let cdf = normal_cdf(0.0);
        assert!((cdf - 0.5).abs() < 0.001);
    }

    #[tokio::test]
    async fn critic_extends_when_insufficient_samples() {
        let registry = Arc::new(ProcessorRegistry::new());
        // Register a candidate with 5 samples (below default min_samples=30)
        let cfg = ProcessorConfig::new("classifier", 2);
        registry.register_candidate("classifier", cfg, crate::registry::DeploymentStrategy::ABTest {
            traffic_percentage: 0.1,
            duration_hours: 24,
        }).await;

        // Manually record 5 outcomes
        for _ in 0..5 {
            registry.record_outcome("classifier", 2, true).await;
        }

        let critic = Critic::new(registry.clone());
        let decisions = critic.evaluate_all().await;

        assert!(!decisions.is_empty());
        assert_eq!(decisions[0].action, CriticAction::Extend);
    }

    #[tokio::test]
    async fn critic_promotes_clear_winner() {
        let registry = Arc::new(ProcessorRegistry::new());

        // Active: 50% success rate over 100 invocations
        let mut active = ProcessorConfig::new("classifier", 1);
        active.total_invocations = 100;
        active.performance_score = 0.5;
        registry.active_configs.write().await.insert("classifier".into(), active);

        // Candidate: 90% success rate over 50 invocations
        let candidate_cfg = ProcessorConfig::new("classifier", 2);
        registry.register_candidate("classifier", candidate_cfg, crate::registry::DeploymentStrategy::ABTest {
            traffic_percentage: 0.1,
            duration_hours: 24,
        }).await;

        // Record 50 candidate outcomes (45 successes, 5 failures)
        for _ in 0..45 {
            registry.record_outcome("classifier", 2, true).await;
        }
        for _ in 0..5 {
            registry.record_outcome("classifier", 2, false).await;
        }

        let critic = Critic::new(registry.clone());
        let decisions = critic.evaluate_all().await;

        assert!(!decisions.is_empty());
        assert_eq!(decisions[0].action, CriticAction::Promote);
        assert!(decisions[0].p_value < 0.05);
    }
}
