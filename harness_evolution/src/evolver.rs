//! Evolver — materializes an EvolutionProposal into a new candidate processor.
//!
//! Takes a Proposal (which contains abstract modifications) and produces
//! a concrete `ProcessorConfig` representing the new version. The new
//! config is registered as a candidate in the ProcessorRegistry with
//! a deployment strategy (Shadow or ABTest).
//!
//! The Evolver does NOT instantiate the new processor object itself —
//! that's the responsibility of the slot-specific factory. The Evolver
//! just produces the config and registers it.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tracing::{info, warn};

use crate::planner::EvolutionProposal;
use crate::processor::ProcessorConfig;
use crate::registry::{DeploymentStrategy, ProcessorRegistry};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvolutionResult {
    pub proposal_id: String,
    pub slot: String,
    pub new_version: u32,
    pub new_config: ProcessorConfig,
    pub deployment: DeploymentStrategySnapshot,
    pub success: bool,
    pub error: Option<String>,
}

/// Serializable version of DeploymentStrategy (the original contains no
/// non-serializable fields, but we re-wrap here for clean API).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DeploymentStrategySnapshot {
    Shadow,
    ABTest { traffic_percentage: f64, duration_hours: u32 },
    Immediate,
}

impl From<&DeploymentStrategy> for DeploymentStrategySnapshot {
    fn from(d: &DeploymentStrategy) -> Self {
        match d {
            DeploymentStrategy::Shadow => DeploymentStrategySnapshot::Shadow,
            DeploymentStrategy::ABTest { traffic_percentage, duration_hours } =>
                DeploymentStrategySnapshot::ABTest { traffic_percentage: *traffic_percentage, duration_hours: *duration_hours },
            DeploymentStrategy::Immediate => DeploymentStrategySnapshot::Immediate,
        }
    }
}

pub struct Evolver {
    registry: Arc<ProcessorRegistry>,
    /// Default A/B test traffic percentage (10%)
    pub default_ab_traffic: f64,
    /// Default A/B test duration in hours (24h = 1 day)
    pub default_ab_duration_hours: u32,
    /// Minimum confidence threshold for a proposal to be evolved
    pub min_proposal_confidence: f32,
}

impl Evolver {
    pub fn new(registry: Arc<ProcessorRegistry>) -> Self {
        Self {
            registry,
            default_ab_traffic: 0.10,
            default_ab_duration_hours: 24,
            min_proposal_confidence: 0.40,
        }
    }

    /// Materialize a proposal into a new candidate processor config.
    pub async fn evolve(&self, proposal: &EvolutionProposal) -> EvolutionResult {
        // Gate on confidence
        if proposal.confidence < self.min_proposal_confidence {
            warn!(
                "Rejecting proposal {} — confidence {:.2} below threshold {:.2}",
                proposal.id, proposal.confidence, self.min_proposal_confidence
            );
            return EvolutionResult {
                proposal_id: proposal.id.clone(),
                slot: proposal.slot.clone(),
                new_version: proposal.parent_version + 1,
                new_config: ProcessorConfig::new(&proposal.slot, proposal.parent_version + 1),
                deployment: DeploymentStrategySnapshot::Shadow,
                success: false,
                error: Some(format!("confidence {:.2} below threshold", proposal.confidence)),
            };
        }

        // Get the parent config to clone + modify
        let parent_config = match self.registry.get_active_config(&proposal.slot).await {
            Some(c) => c,
            None => {
                warn!("No active config for slot '{}', cannot evolve", proposal.slot);
                return EvolutionResult {
                    proposal_id: proposal.id.clone(),
                    slot: proposal.slot.clone(),
                    new_version: 1,
                    new_config: ProcessorConfig::new(&proposal.slot, 1),
                    deployment: DeploymentStrategySnapshot::Shadow,
                    success: false,
                    error: Some(format!("no active config for slot '{}'", proposal.slot)),
                };
            }
        };

        // Clone and bump version
        let mut new_config = parent_config.clone();
        new_config.version = parent_config.version + 1;
        new_config.parent_version = Some(parent_config.version);
        new_config.origin_proposal_id = Some(proposal.id.clone());
        new_config.created_at = chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0);
        new_config.total_invocations = 0;
        new_config.performance_score = 0.0; // Reset — will accumulate via EMA

        // Apply each modification
        for modification in &proposal.modifications {
            if let Err(e) = self.apply_modification(&mut new_config, modification) {
                warn!("Failed to apply modification {:?}: {}", modification.change_type, e);
                return EvolutionResult {
                    proposal_id: proposal.id.clone(),
                    slot: proposal.slot.clone(),
                    new_version: new_config.version,
                    new_config,
                    deployment: DeploymentStrategySnapshot::Shadow,
                    success: false,
                    error: Some(format!("modification failed: {e}")),
                };
            }
        }

        // Recompute implementation hash (drift detection)
        new_config.implementation_hash = new_config.compute_hash();

        // Choose deployment strategy
        let deployment = self.choose_deployment_strategy(proposal);

        // Register as candidate
        let deployment_for_registry = match deployment {
            DeploymentStrategySnapshot::Shadow => DeploymentStrategy::Shadow,
            DeploymentStrategySnapshot::ABTest { traffic_percentage, duration_hours } =>
                DeploymentStrategy::ABTest { traffic_percentage, duration_hours },
            DeploymentStrategySnapshot::Immediate => DeploymentStrategy::Immediate,
        };

        self.registry.register_candidate(
            &proposal.slot,
            new_config.clone(),
            deployment_for_registry,
        ).await;

        info!(
            "Evolved slot '{}' v{} → v{} (proposal {}, deployment={:?})",
            proposal.slot, parent_config.version, new_config.version,
            proposal.id, deployment
        );

        EvolutionResult {
            proposal_id: proposal.id.clone(),
            slot: proposal.slot.clone(),
            new_version: new_config.version,
            new_config,
            deployment,
            success: true,
            error: None,
        }
    }

    fn apply_modification(
        &self,
        config: &mut ProcessorConfig,
        modification: &crate::planner::HarnessModification,
    ) -> anyhow::Result<()> {
        use crate::planner::ChangeType;

        match modification.change_type {
            ChangeType::PromptTweak | ChangeType::AddFewShotExamples => {
                let new_prompt = modification.new_value.as_str()
                    .ok_or_else(|| anyhow::anyhow!("new_value must be string for prompt tweak"))?;
                config.prompt_template = Some(new_prompt.to_string());
            }
            ChangeType::ContextBudgetAdjust => {
                let new_budget = modification.new_value.as_u64()
                    .ok_or_else(|| anyhow::anyhow!("new_value must be u64 for budget adjust"))?
                    as u32;
                if let Some(strategies) = config.context_strategies.as_mut() {
                    // Distribute the new budget proportionally across strategies
                    let total: u32 = strategies.iter().map(|s| s.max_tokens).sum();
                    if total > 0 {
                        for s in strategies.iter_mut() {
                            s.max_tokens = (s.max_tokens as f64 * new_budget as f64 / total as f64) as u32;
                        }
                    }
                }
            }
            ChangeType::ContextStrategyToggle => {
                // Field looks like "context_strategies[SemanticRecall].enabled"
                let field = &modification.field;
                if let Some(name_start) = field.find('[') {
                    if let Some(name_end) = field.find(']') {
                        let strategy_name = &field[name_start + 1..name_end];
                        let new_enabled = modification.new_value.as_bool()
                            .ok_or_else(|| anyhow::anyhow!("new_value must be bool for toggle"))?;
                        if let Some(strategies) = config.context_strategies.as_mut() {
                            for s in strategies.iter_mut() {
                                if s.name == strategy_name {
                                    s.enabled = new_enabled;
                                }
                            }
                        }
                    }
                }
            }
            ChangeType::RoutingRulePriority => {
                if let Some(rules) = config.routing_rules.as_mut() {
                    let intent = modification.field.strip_prefix("routing_rules[")
                        .and_then(|s| s.strip_suffix("].priority"))
                        .unwrap_or(&modification.field);
                    let new_priority = modification.new_value.as_i64()
                        .ok_or_else(|| anyhow::anyhow!("new_value must be i64 for priority"))?
                        as i32;
                    for r in rules.iter_mut() {
                        if r.intent == intent {
                            r.priority = new_priority;
                        }
                    }
                }
            }
            ChangeType::ModelSwitch => {
                // Model is set in tool_config, not in ProcessorConfig directly
                let new_model = modification.new_value.as_str()
                    .ok_or_else(|| anyhow::anyhow!("new_value must be string for model switch"))?;
                let mut tc = config.tool_config.clone().unwrap_or(serde_json::json!({}));
                if let Some(obj) = tc.as_object_mut() {
                    obj.insert("model".into(), serde_json::json!(new_model));
                } else {
                    tc = serde_json::json!({ "model": new_model });
                }
                config.tool_config = Some(tc);
            }
            ChangeType::ParameterTuning => {
                // Generic parameter — store in tool_config
                let mut tc = config.tool_config.clone().unwrap_or(serde_json::json!({}));
                if let Some(obj) = tc.as_object_mut() {
                    obj.insert(modification.field.clone(), modification.new_value.clone());
                }
                config.tool_config = Some(tc);
            }
        }
        Ok(())
    }

    fn choose_deployment_strategy(&self, proposal: &EvolutionProposal) -> DeploymentStrategySnapshot {
        // High-confidence proposals → A/B test with 10% traffic for 24h
        // Medium-confidence → Shadow only (no live traffic)
        // Low-confidence → filtered out by min_proposal_confidence gate
        if proposal.confidence >= 0.65 {
            DeploymentStrategySnapshot::ABTest {
                traffic_percentage: self.default_ab_traffic,
                duration_hours: self.default_ab_duration_hours,
            }
        } else {
            DeploymentStrategySnapshot::Shadow
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::planner::{EvolutionProposal, ProposalTrigger, HarnessModification, ChangeType};

    #[tokio::test]
    async fn reject_low_confidence_proposal() {
        let registry = Arc::new(ProcessorRegistry::new());
        let evolver = Evolver::new(registry);

        let proposal = EvolutionProposal {
            id: "test-1".into(),
            created_at: 0,
            trigger: ProposalTrigger::Manual,
            slot: "classifier".into(),
            parent_version: 1,
            modifications: vec![],
            hypothesis: "test".into(),
            success_metric: "test".into(),
            confidence: 0.20, // below default threshold of 0.40
        };

        let result = evolver.evolve(&proposal).await;
        assert!(!result.success);
        assert!(result.error.unwrap().contains("confidence"));
    }

    #[tokio::test]
    async fn evolve_with_no_active_config_fails() {
        let registry = Arc::new(ProcessorRegistry::new());
        let evolver = Evolver::new(registry);

        let proposal = EvolutionProposal {
            id: "test-2".into(),
            created_at: 0,
            trigger: ProposalTrigger::Manual,
            slot: "classifier".into(),
            parent_version: 1,
            modifications: vec![HarnessModification {
                change_type: ChangeType::PromptTweak,
                field: "prompt_template".into(),
                old_value: serde_json::json!(""),
                new_value: serde_json::json!("Be concise."),
                rationale: "test".into(),
            }],
            hypothesis: "test".into(),
            success_metric: "test".into(),
            confidence: 0.80,
        };

        let result = evolver.evolve(&proposal).await;
        assert!(!result.success);
        assert!(result.error.unwrap().contains("no active config"));
    }

    #[tokio::test]
    async fn evolve_bumps_version_and_applies_modification() {
        let registry = Arc::new(ProcessorRegistry::new());
        // Manually register an active config
        let mut cfg = ProcessorConfig::new("classifier", 1);
        cfg.prompt_template = Some("original prompt".into());
        registry.active_configs.write().await.insert("classifier".into(), cfg);

        let evolver = Evolver::new(registry.clone());

        let proposal = EvolutionProposal {
            id: "test-3".into(),
            created_at: 0,
            trigger: ProposalTrigger::Manual,
            slot: "classifier".into(),
            parent_version: 1,
            modifications: vec![HarnessModification {
                change_type: ChangeType::PromptTweak,
                field: "prompt_template".into(),
                old_value: serde_json::json!("original prompt"),
                new_value: serde_json::json!("Be concise and accurate."),
                rationale: "test".into(),
            }],
            hypothesis: "test".into(),
            success_metric: "test".into(),
            confidence: 0.75,
        };

        let result = evolver.evolve(&proposal).await;
        assert!(result.success);
        assert_eq!(result.new_version, 2);
        assert_eq!(result.new_config.prompt_template.as_deref(), Some("Be concise and accurate."));
        assert_eq!(result.new_config.parent_version, Some(1));
        assert_eq!(result.new_config.origin_proposal_id.as_deref(), Some("test-3"));

        // Verify candidate was registered
        let candidates = registry.get_candidates("classifier").await;
        assert_eq!(candidates.len(), 1);
    }
}
