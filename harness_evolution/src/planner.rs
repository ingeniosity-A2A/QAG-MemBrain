//! Planner — analyzes DayDigests and proposes evolution changes.
//!
//! The Planner is the "brain" of the evolution loop. It looks at:
//!   - Which slots have high failure rates?
//!   - Which routes are slow?
//!   - Which failure patterns recur most?
//!   - Which processors have declining trust trajectories?
//!
//! And produces EvolutionProposals, each containing one or more
//! HarnessModifications. A modification might be:
//!   - Tweak a prompt template
//!   - Adjust routing rule priority
//!   - Change context_budget for a slot
//!   - Disable a context strategy
//!   - Switch the model used by a slot
//!
//! Proposals are conservative: small changes, one variable at a time,
//! so the Critic can attribute outcome deltas to specific modifications.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tracing::{info, warn};

use crate::digester::{DayDigest, FailureType};
use crate::processor::ProcessorConfig;
use crate::registry::ProcessorRegistry;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvolutionProposal {
    pub id: String,
    pub created_at: i64,
    pub trigger: ProposalTrigger,
    pub slot: String,
    pub parent_version: u32,
    pub modifications: Vec<HarnessModification>,
    /// Hypothesis — what we expect to improve
    pub hypothesis: String,
    /// Expected success metric (e.g. "reduce LowConfidence rate by 30%")
    pub success_metric: String,
    /// Confidence in this proposal (0.0–1.0) — gates whether it's worth A/B testing
    pub confidence: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ProposalTrigger {
    /// Slot failure rate exceeded threshold
    HighFailureRate { rate: f32, threshold: f32 },
    /// Specific failure type dominates
    DominantFailureType { ftype: FailureType, count: u64 },
    /// Trust trajectory declining across sessions
    DecliningTrust { start: f32, end: f32 },
    /// Latency exceeding budget consistently
    LatencyRegression { p95_ms: u64, budget_ms: u64 },
    /// Manual trigger (user requested)
    Manual,
    /// Periodic refresh
    Periodic,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ChangeType {
    PromptTweak,
    RoutingRulePriority,
    ContextBudgetAdjust,
    ContextStrategyToggle,
    ModelSwitch,
    AddFewShotExamples,
    ParameterTuning,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HarnessModification {
    pub change_type: ChangeType,
    pub field: String,
    pub old_value: serde_json::Value,
    pub new_value: serde_json::Value,
    pub rationale: String,
}

pub struct EvolutionPlanner {
    registry: Arc<ProcessorRegistry>,
    /// Threshold above which a slot is considered "struggling"
    pub failure_rate_threshold: f32,
    /// Min occurrences of a failure type before proposing a fix
    pub min_failure_count: u64,
}

impl EvolutionPlanner {
    pub fn new(registry: Arc<ProcessorRegistry>) -> Self {
        Self {
            registry,
            failure_rate_threshold: 0.20,
            min_failure_count: 3,
        }
    }

    /// Analyze a DayDigest and produce zero or more EvolutionProposals.
    pub async fn plan(&self, digest: &DayDigest) -> Vec<EvolutionProposal> {
        let mut proposals = Vec::new();

        // ── Strategy 1: High failure rate per slot ────────────────────
        for (slot, stats) in &digest.slot_stats {
            if stats.total_invocations < self.min_failure_count {
                continue;
            }
            let failure_rate = stats.failures as f32 / stats.total_invocations as f32;
            if failure_rate > self.failure_rate_threshold {
                if let Some(proposal) = self.propose_for_high_failure(slot, stats, failure_rate, digest).await {
                    proposals.push(proposal);
                }
            }
        }

        // ── Strategy 2: Dominant failure types ────────────────────────
        for pattern in &digest.failure_patterns {
            if pattern.occurrence_count < self.min_failure_count {
                continue;
            }
            if let Some(proposal) = self.propose_for_failure_pattern(pattern, digest).await {
                // Avoid duplicate proposals for the same slot
                if !proposals.iter().any(|p| p.slot == pattern.slot) {
                    proposals.push(proposal);
                }
            }
        }

        // ── Strategy 3: Declining trust trajectories ──────────────────
        for session in &digest.sessions {
            if session.trust_trajectory.trend == "falling"
                && session.trust_trajectory.end_trust < 0.4 {
                if let Some(proposal) = self.propose_for_declining_trust(session, digest).await {
                    if !proposals.iter().any(|p| p.slot == proposal.slot) {
                        proposals.push(proposal);
                    }
                }
            }
        }

        // Sort by confidence descending
        proposals.sort_by(|a, b| b.confidence.partial_cmp(&a.confidence).unwrap_or(std::cmp::Ordering::Equal));

        info!("Planner produced {} proposals for {}", proposals.len(), digest.date);
        for p in &proposals {
            info!("  → {} (slot={}, confidence={:.2})", p.id, p.slot, p.confidence);
        }

        proposals
    }

    async fn propose_for_high_failure(
        &self,
        slot: &str,
        stats: &crate::digester::SlotStats,
        failure_rate: f32,
        _digest: &DayDigest,
    ) -> Option<EvolutionProposal> {
        let active_config = self.registry.get_active_config(slot).await?;

        let modifications = vec![HarnessModification {
            change_type: ChangeType::ContextBudgetAdjust,
            field: "context_budget".into(),
            old_value: serde_json::json!(active_config.context_strategies.as_ref()
                .map(|s| s.iter().map(|s| s.max_tokens).sum::<u32>())
                .unwrap_or(0)),
            new_value: serde_json::json!(active_config.context_strategies.as_ref()
                .map(|s| s.iter().map(|s| s.max_tokens).sum::<u32>())
                .unwrap_or(0) + 8),
            rationale: format!(
                "Slot '{}' has {:.0}% failure rate ({} of {} invocations). \
                 Increasing context budget by 8 tokens to give the model more \
                 background to make confident decisions.",
                slot, failure_rate * 100.0, stats.failures, stats.total_invocations
            ),
        }];

        Some(EvolutionProposal {
            id: format!("prop_{}_{}_{}", slot, active_config.version + 1, chrono::Utc::now().timestamp()),
            created_at: chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0),
            trigger: ProposalTrigger::HighFailureRate {
                rate: failure_rate,
                threshold: self.failure_rate_threshold,
            },
            slot: slot.to_string(),
            parent_version: active_config.version,
            modifications,
            hypothesis: format!("Increasing context budget for {} will reduce failure rate by ≥20%", slot),
            success_metric: format!("Reduce failure rate from {:.0}% to <15%", failure_rate * 100.0),
            confidence: 0.65,
        })
    }

    async fn propose_for_failure_pattern(
        &self,
        pattern: &crate::digester::FailurePattern,
        _digest: &DayDigest,
    ) -> Option<EvolutionProposal> {
        let active_config = self.registry.get_active_config(&pattern.slot).await?;

        let (modification, hypothesis, confidence) = match pattern.failure_type {
            FailureType::LowConfidence => {
                // Propose adding few-shot examples to the prompt
                let old_prompt = active_config.prompt_template.clone().unwrap_or_default();
                let new_prompt = format!(
                    "{}\n\n## Examples\n[user]: What is photosynthesis?\n[assistant]: Photosynthesis is the process by which plants convert light into energy.\n[user]: Why is the sky blue?\n[assistant]: The sky appears blue because of Rayleigh scattering of sunlight by the atmosphere.\n",
                    old_prompt
                );
                (
                    HarnessModification {
                        change_type: ChangeType::AddFewShotExamples,
                        field: "prompt_template".into(),
                        old_value: serde_json::json!(old_prompt),
                        new_value: serde_json::json!(new_prompt),
                        rationale: format!(
                            "LowConfidence failures in '{}' ({} occurrences). Adding few-shot examples \
                             typically lifts confidence by demonstrating expected output style.",
                            pattern.slot, pattern.occurrence_count
                        ),
                    },
                    "Few-shot examples will increase avg confidence from <0.4 to >0.6".to_string(),
                    0.75,
                )
            }
            FailureType::LatencyBudgetExceeded => {
                // Propose reducing context budget
                let old_budget = active_config.context_strategies.as_ref()
                    .map(|s| s.iter().map(|s| s.max_tokens).sum::<u32>())
                    .unwrap_or(0);
                let new_budget = (old_budget as f32 * 0.7) as u32;
                (
                    HarnessModification {
                        change_type: ChangeType::ContextBudgetAdjust,
                        field: "context_budget".into(),
                        old_value: serde_json::json!(old_budget),
                        new_value: serde_json::json!(new_budget),
                        rationale: format!(
                            "LatencyBudgetExceeded in '{}' ({} occurrences). Cutting context budget \
                             by 30% should reduce latency below budget.",
                            pattern.slot, pattern.occurrence_count
                        ),
                    },
                    "Reduced context will bring p95 latency under budget".to_string(),
                    0.55,
                )
            }
            FailureType::BudgetExhausted => {
                // Propose switching to a smaller/faster model
                (
                    HarnessModification {
                        change_type: ChangeType::ModelSwitch,
                        field: "model".into(),
                        old_value: serde_json::json!("fable-12b"),
                        new_value: serde_json::json!("gemma-2b"),
                        rationale: format!(
                            "BudgetExhausted in '{}' ({} occurrences). Switching from FABLE 12B to \
                             Gemma 2B (faster, cheaper) should fit within budget.",
                            pattern.slot, pattern.occurrence_count
                        ),
                    },
                    "Smaller model will reduce per-turn token cost by ~60%".to_string(),
                    0.60,
                )
            }
            FailureType::ThermalThrottled => {
                // Propose disabling heavy context strategies during thermal events
                (
                    HarnessModification {
                        change_type: ChangeType::ContextStrategyToggle,
                        field: "context_strategies[SemanticRecall].enabled".into(),
                        old_value: serde_json::json!(true),
                        new_value: serde_json::json!(false),
                        rationale: format!(
                            "ThermalThrottled in '{}' ({} occurrences). Disabling semantic recall \
                             reduces embedding compute load during thermal events.",
                            pattern.slot, pattern.occurrence_count
                        ),
                    },
                    "Disabling VSS recall under thermal pressure will prevent throttling cascades".to_string(),
                    0.50,
                )
            }
            _ => {
                // Generic: don't auto-propose for unknown / user-cancelled / knox-blocked
                return None;
            }
        };

        Some(EvolutionProposal {
            id: format!("prop_{}_{}_{}", pattern.slot, active_config.version + 1, chrono::Utc::now().timestamp()),
            created_at: chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0),
            trigger: ProposalTrigger::DominantFailureType {
                ftype: pattern.failure_type,
                count: pattern.occurrence_count,
            },
            slot: pattern.slot.clone(),
            parent_version: active_config.version,
            modifications: vec![modification],
            hypothesis,
            success_metric: format!("Reduce {} occurrences by ≥40%", pattern.failure_type.as_str()),
            confidence,
        })
    }

    async fn propose_for_declining_trust(
        &self,
        session: &crate::digester::SessionDigest,
        _digest: &DayDigest,
    ) -> Option<EvolutionProposal> {
        // Find the slot with the most failure points in this session
        let mut slot_counts: std::collections::HashMap<String, u64> = std::collections::HashMap::new();
        for fp in &session.failure_points {
            *slot_counts.entry(fp.slot.clone()).or_insert(0) += 1;
        }
        let (worst_slot, _) = slot_counts.into_iter()
            .max_by_key(|(_, c)| *c)
            .filter(|(_, c)| *c > 0)?;

        let active_config = self.registry.get_active_config(&worst_slot).await?;

        Some(EvolutionProposal {
            id: format!("prop_{}_{}_trust", worst_slot, active_config.version + 1),
            created_at: chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0),
            trigger: ProposalTrigger::DecliningTrust {
                start: session.trust_trajectory.start_trust,
                end: session.trust_trajectory.end_trust,
            },
            slot: worst_slot.clone(),
            parent_version: active_config.version,
            modifications: vec![HarnessModification {
                change_type: ChangeType::PromptTweak,
                field: "prompt_template".into(),
                old_value: serde_json::json!(active_config.prompt_template.clone().unwrap_or_default()),
                new_value: serde_json::json!(
                    "Be more conservative. If you are not confident, say so explicitly rather than guessing.\n\n"
                ),
                rationale: format!(
                    "Trust trajectory in session {} declined from {:.2} to {:.2}. Adding a \
                     conservative instruction to the {} prompt to reduce overconfident failures.",
                    session.session_id,
                    session.trust_trajectory.start_trust,
                    session.trust_trajectory.end_trust,
                    worst_slot
                ),
            }],
            hypothesis: "Conservative prompt tweak will stabilize trust trajectory".to_string(),
            success_metric: "End-of-session trust ≥ 0.5 in 80% of sessions".to_string(),
            confidence: 0.55,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::digester::{DayDigest, SlotStats, FailurePattern, SessionDigest, TrustTrajectory, Outcome, FailureType, FailurePoint, RouteStats};
    use std::collections::HashMap;

    fn empty_digest() -> DayDigest {
        DayDigest {
            date: "2026-06-27".into(),
            total_receipts: 0,
            total_sessions: 0,
            slot_stats: HashMap::new(),
            route_stats: HashMap::new(),
            failure_patterns: vec![],
            sessions: vec![],
            avg_trust_score: 0.0,
            total_tokens: 0,
            total_latency_ms: 0,
        }
    }

    #[tokio::test]
    async fn empty_digest_produces_no_proposals() {
        let registry = Arc::new(ProcessorRegistry::new());
        let planner = EvolutionPlanner::new(registry);
        let proposals = planner.plan(&empty_digest()).await;
        assert!(proposals.is_empty());
    }

    #[tokio::test]
    async fn high_failure_rate_triggers_proposal() {
        let registry = Arc::new(ProcessorRegistry::new());
        // Manually register a classifier config
        let mut cfg = ProcessorConfig::new("classifier", 1);
        cfg.context_strategies = Some(vec![crate::processor::ContextStrategy {
            name: "SemanticRecall".into(),
            weight: 1.0,
            max_tokens: 8,
            enabled: true,
        }]);
        registry.active_configs.write().await.insert("classifier".into(), cfg);

        let planner = EvolutionPlanner::new(registry);

        let mut digest = empty_digest();
        digest.slot_stats.insert("classifier".into(), SlotStats {
            total_invocations: 10,
            successes: 5,
            failures: 5,  // 50% failure rate
            avg_confidence: 0.4,
            avg_latency_ms: 200,
        });

        let proposals = planner.plan(&digest).await;
        assert!(!proposals.is_empty());
        assert_eq!(proposals[0].slot, "classifier");
    }
}
