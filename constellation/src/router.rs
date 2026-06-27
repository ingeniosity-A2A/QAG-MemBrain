//! Constellation router — picks the optimal model for a request.
//!
//! Selection algorithm:
//!   1. Hard constraints filter (thermal, battery, offline, health, context)
//!   2. Score remaining candidates (cost, latency, capability match)
//!   3. Pick top + set fallback

use std::sync::Arc;

use tracing::{info, warn};

use crate::health::HealthRegistry;
use crate::model::*;
use crate::signals::*;

/// The Constellation — picks models for requests.
pub struct Constellation {
    /// All models known to the registry
    models: Vec<ModelConfig>,
    /// Runtime health per model
    health: Arc<HealthRegistry>,
}

impl Constellation {
    pub fn new(models: Vec<ModelConfig>, health: Arc<HealthRegistry>) -> Self {
        Self { models, health }
    }

    /// Select the optimal model for a request.
    /// Pure function: signals → ModelAssignment.
    pub fn route(&self, signals: &RoutingSignals) -> ModelAssignment {
        // ── Step 1: Hard constraints eliminate options ──────────────
        let candidates: Vec<&ModelConfig> = self.models.iter()
            .filter(|m| self.meets_constraints(m, signals))
            .collect();

        if candidates.is_empty() {
            warn!("No viable model found — falling back to Gemma2B regardless of constraints");
            return emergency_fallback();
        }

        // ── Step 2: Score remaining candidates ───────────────────────
        let mut scored: Vec<(&ModelConfig, f64)> = candidates.iter()
            .map(|m| (*m, self.score_model(m, signals)))
            .collect();
        scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

        // ── Step 3: Select best + assign fallback ────────────────────
        let primary = scored.first()
            .map(|(m, _)| *m)
            .expect("candidates non-empty (checked above)");
        let fallback = scored.get(1).map(|(m, _)| *m);

        let assignment = ModelAssignment {
            model: primary.id.clone(),
            endpoint: primary.endpoint.clone(),
            timeout_ms: compute_timeout(primary, signals),
            fallback: fallback.map(|f| Box::new(ModelAssignment {
                model: f.id.clone(),
                endpoint: f.endpoint.clone(),
                timeout_ms: compute_timeout(f, signals),
                fallback: None,
                quantization: f.quantization,
                reasoning: "Fallback if primary fails".into(),
            })),
            quantization: primary.quantization,
            reasoning: explain_decision(primary, signals),
        };

        info!(
            "Constellation routed intent={} → {} (timeout={}ms, fallback={})",
            signals.intent_bucket,
            assignment.model.as_str(),
            assignment.timeout_ms,
            assignment.fallback.as_ref().map(|f| f.model.as_str()).unwrap_or("(none)"),
        );

        assignment
    }

    /// Hard constraint check — eliminates models that can't serve this request.
    fn meets_constraints(&self, model: &ModelConfig, signals: &RoutingSignals) -> bool {
        // Thermal critical: only lightweight local models
        if signals.thermal == ThermalState::Critical {
            return matches!(model.id, ModelId::Gemma2B | ModelId::Embedding384);
        }

        // Thermal warm: no heavy local models
        if signals.thermal == ThermalState::Warm {
            if matches!(model.id, ModelId::Gemma12B | ModelId::Qwen7B) {
                return false;
            }
        }

        // Offline: no cloud models
        if signals.connectivity == Connectivity::Offline {
            if matches!(model.endpoint, ModelEndpoint::Cloud { .. }) {
                return false;
            }
        }

        // Battery critical (< 10%): local only, lightweight only
        if signals.battery_pct < 0.10 {
            return matches!(model.id, ModelId::Gemma2B | ModelId::Embedding384);
        }

        // Battery low (< 25%): no heavy models
        if signals.battery_pct < 0.25 {
            if matches!(model.id, ModelId::Gemma12B | ModelId::Qwen7B) {
                return false;
            }
        }

        // Latency budget: model must be fast enough
        if let Some(budget_ms) = signals.latency_budget_ms {
            if model.avg_latency_ms > budget_ms {
                return false;
            }
        }

        // Model health: recently failing models are excluded
        let health = self.health.get(&model.id);
        if !health.available || health.recent_failures > 3 {
            return false;
        }

        // Context window: model must handle the input length
        if signals.estimated_tokens > model.max_context_tokens {
            return false;
        }

        true
    }

    /// Score a model for this request — higher = better fit.
    fn score_model(&self, model: &ModelConfig, signals: &RoutingSignals) -> f64 {
        let mut score: f64 = 0.0;

        // Capability match (intent → model)
        score += self.capability_match_score(model, signals) * 100.0;

        // Cost penalty (prefer local / cheaper)
        score -= model.cost_per_1k_tokens * 10.0;

        // Latency score (faster = better, but only up to a point)
        if model.avg_latency_ms < 200 {
            score += 30.0;
        } else if model.avg_latency_ms < 1000 {
            score += 15.0;
        } else if model.avg_latency_ms < 3000 {
            score += 0.0;
        } else {
            score -= 20.0;
        }

        // Health bonus (high success rate = better)
        let health = self.health.get(&model.id);
        score += health.success_rate * 20.0;

        // Load penalty (avoid overloading a busy model)
        score -= (health.current_load as f64) * 25.0;

        // Latency budget fit (prefer models well within budget)
        if let Some(budget_ms) = signals.latency_budget_ms {
            let headroom = budget_ms as f64 - model.avg_latency_ms as f64;
            score += (headroom / budget_ms as f64) * 15.0;
        }

        // Session budget: prefer cheaper models when budget is tight
        if signals.session_budget_remaining < 5000 {
            score -= model.cost_per_1k_tokens * 50.0;
            if model.avg_latency_ms > 1000 {
                score -= 30.0;
            }
        }

        score
    }

    /// How well does this model's capabilities match the intent bucket?
    fn capability_match_score(&self, model: &ModelConfig, signals: &RoutingSignals) -> f64 {
        let intent_lower = signals.intent_bucket.to_lowercase();

        // Direct capability match
        if model.capabilities.iter().any(|c| c.to_lowercase() == intent_lower) {
            return 1.0;
        }

        // Heuristic mappings
        match (model.id.clone(), signals.intent_bucket.as_str()) {
            // Question / Chitchat → Gemma 2B
            (ModelId::Gemma2B, "Question") => 0.95,
            (ModelId::Gemma2B, "Chitchat") => 0.95,
            (ModelId::Gemma2B, "UiNavigation") => 0.90,
            (ModelId::Gemma2B, "MemoryOp") => 0.85,

            // Planning / Synthesis → Gemma 12B
            (ModelId::Gemma12B, "Planning") => 0.95,
            (ModelId::Gemma12B, "Synthesis") => 0.90,
            (ModelId::Gemma12B, "Unknown") => 0.70, // Fallback for low-confidence

            // Embeddings for semantic search
            (ModelId::Embedding384, _) if intent_lower.contains("search") => 0.95,

            // Cloud fallbacks
            (ModelId::Claude, "Planning") => 0.80,
            (ModelId::Claude, "Synthesis") => 0.85,
            (ModelId::GPT4o, _) if signals.requires_tools => 0.90,

            // Qwen for multilingual
            (ModelId::Qwen7B, _) if intent_lower.contains("translate") => 0.85,

            // Default: mild preference for local
            (ModelId::Gemma2B, _) => 0.50,
            (ModelId::Gemma12B, _) => 0.30,
            _ => 0.10,
        }
    }
}

fn compute_timeout(model: &ModelConfig, signals: &RoutingSignals) -> u64 {
    let base = model.avg_latency_ms * 2; // 2x avg for safety margin
    if let Some(budget_ms) = signals.latency_budget_ms {
        // Use the smaller of 2x avg or user budget
        base.min(budget_ms)
    } else {
        base
    }
    .max(500) // minimum 500ms
}

fn explain_decision(model: &ModelConfig, signals: &RoutingSignals) -> String {
    format!(
        "Routed {} ({}ms avg, ${:.4}/1k tok) for intent={} (conf={:.2}, tokens={}, thermal={:?}, battery={:.0}%)",
        model.id.as_str(),
        model.avg_latency_ms,
        model.cost_per_1k_tokens,
        signals.intent_bucket,
        signals.confidence,
        signals.estimated_tokens,
        signals.thermal,
        signals.battery_pct * 100.0,
    )
}

fn emergency_fallback() -> ModelAssignment {
    ModelAssignment {
        model: ModelId::Gemma2B,
        endpoint: ModelEndpoint::Local { port: 8080 },
        timeout_ms: 3000,
        fallback: None,
        quantization: Quantization::Q4KM,
        reasoning: "Emergency fallback — no viable model met constraints, defaulting to Gemma 2B".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::registry::default_registry;

    fn make_constellation() -> Constellation {
        let health = Arc::new(HealthRegistry::new());
        let models = default_registry();
        // Mark all default models available
        for m in &models {
            health.set_available(&m.id, true);
        }
        Constellation::new(models, health)
    }

    #[test]
    fn question_routes_to_gemma_2b() {
        let c = make_constellation();
        let signals = RoutingSignals {
            intent_bucket: "Question".into(),
            confidence: 0.85,
            estimated_tokens: 256,
            battery_pct: 0.8,
            thermal: ThermalState::Normal,
            connectivity: Connectivity::Connected,
            latency_budget_ms: Some(5000),
            session_budget_remaining: 50_000,
            requires_tools: false,
        };
        let assignment = c.route(&signals);
        assert_eq!(assignment.model, ModelId::Gemma2B);
    }

    #[test]
    fn planning_routes_to_gemma_12b() {
        let c = make_constellation();
        let signals = RoutingSignals {
            intent_bucket: "Planning".into(),
            ..Default::default()
        };
        let assignment = c.route(&signals);
        assert_eq!(assignment.model, ModelId::Gemma12B);
    }

    #[test]
    fn thermal_critical_forces_gemma_2b_only() {
        let c = make_constellation();
        let signals = RoutingSignals {
            intent_bucket: "Planning".into(),
            thermal: ThermalState::Critical,
            ..Default::default()
        };
        let assignment = c.route(&signals);
        // Even for Planning, thermal critical forces lightweight
        assert!(matches!(assignment.model, ModelId::Gemma2B | ModelId::Embedding384));
    }

    #[test]
    fn offline_blocks_cloud_models() {
        let c = make_constellation();
        let signals = RoutingSignals {
            intent_bucket: "Planning".into(),
            connectivity: Connectivity::Offline,
            thermal: ThermalState::Warm, // also blocks Gemma 12B
            ..Default::default()
        };
        let assignment = c.route(&signals);
        // Should NOT be a cloud model
        assert!(!matches!(assignment.endpoint, ModelEndpoint::Cloud { .. }));
    }

    #[test]
    fn low_battery_blocks_heavy_models() {
        let c = make_constellation();
        let signals = RoutingSignals {
            intent_bucket: "Planning".into(),
            battery_pct: 0.05, // critical
            ..Default::default()
        };
        let assignment = c.route(&signals);
        assert!(matches!(assignment.model, ModelId::Gemma2B | ModelId::Embedding384));
    }

    #[test]
    fn failed_model_is_excluded() {
        let c = make_constellation();
        // Make Gemma 2B fail 5 times — should be marked unavailable
        for _ in 0..5 {
            c.health.record_failure(&ModelId::Gemma2B);
        }
        let signals = RoutingSignals {
            intent_bucket: "Question".into(),
            ..Default::default()
        };
        let assignment = c.route(&signals);
        assert_ne!(assignment.model, ModelId::Gemma2B);
    }

    #[test]
    fn fallback_is_set_when_multiple_candidates() {
        let c = make_constellation();
        let signals = RoutingSignals {
            intent_bucket: "Planning".into(),
            ..Default::default()
        };
        let assignment = c.route(&signals);
        assert!(assignment.fallback.is_some());
    }
}
