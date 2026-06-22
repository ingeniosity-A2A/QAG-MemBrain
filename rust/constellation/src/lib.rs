//! Constellation — AMOS v2.1 dynamic model routing layer.
//!
//! Sits between AVA007/Meta Harness and all inference backends. Routes
//! each inference request to the optimal (model, backend, quantization)
//! tuple based on budget, latency, battery, thermal, and privacy
//! constraints.
//!
//! Built as a Rust crate for NDK + WASM. Real implementation will add
//! `qnn-bridge` as a dependency for NPU probing.

#![forbid(unsafe_code)]
#![deny(missing_debug_implementations)]

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// Available inference backends.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Backend {
    QnnNpu,
    WebGpu,
    Cpu,
    Llamdrop,
    Cloud,
}

impl Backend {
    pub fn as_str(&self) -> &'static str {
        match self {
            Backend::QnnNpu => "qnn_npu",
            Backend::WebGpu => "webgpu",
            Backend::Cpu => "cpu",
            Backend::Llamdrop => "llamdrop",
            Backend::Cloud => "cloud",
        }
    }

    pub fn is_local(&self) -> bool {
        !matches!(self, Backend::Cloud)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Quantization {
    Q0f32,
    Q4f16,
    Q4f32,
    TMan1_58,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskKind {
    Reflex,
    Planning,
    Code,
    Math,
    Reasoning,
    General,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackendInfo {
    pub backend: Backend,
    pub default_model_id: String,
    pub default_quantization: Quantization,
    /// Quality score in [0.0, 1.0].
    pub quality: f32,
    pub tasks: Vec<TaskKind>,
    pub capabilities: BackendCapabilities,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackendCapabilities {
    pub max_context_length: u32,
    pub supports_streaming: bool,
    pub supports_tools: bool,
    pub supports_json_mode: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoutingRequest {
    pub prompt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub budget: Option<Budget>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub require_local: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task: Option<TaskKind>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_confidence: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Budget {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_latency_ms: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_battery_pct: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_cost_usd: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_thermal: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoutingDecision {
    pub backend: Backend,
    pub model_id: String,
    pub quantization: Quantization,
    pub estimated_latency_ms: u32,
    pub estimated_battery_pct: f32,
    pub estimated_cost_usd: f32,
    pub confidence: f32,
    pub rationale: String,
    pub alternatives: Vec<AlternativeDecision>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlternativeDecision {
    pub backend: Backend,
    pub model_id: String,
    pub score: f32,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RoutingError {
    NoBackendAvailable,
    BudgetExceeded { constraint: String, requested: f32, max: f32 },
    AllUnhealthy,
}

impl std::fmt::Display for RoutingError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RoutingError::NoBackendAvailable => write!(f, "no backend available"),
            RoutingError::BudgetExceeded { constraint, requested, max } => {
                write!(f, "budget '{}' exceeded: {} > {}", constraint, requested, max)
            }
            RoutingError::AllUnhealthy => write!(f, "all backends unhealthy"),
        }
    }
}

impl std::error::Error for RoutingError {}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct BudgetEstimate {
    pub latency_ms: u32,
    pub battery_pct: f32,
    pub cost_usd: f32,
    pub thermal: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthStatus {
    pub backend: Backend,
    pub healthy: bool,
    pub last_ok_ms: Option<u64>,
    pub consecutive_failures: u32,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct ScoringWeights {
    pub latency: f32,
    pub battery: f32,
    pub quality: f32,
}

impl Default for ScoringWeights {
    fn default() -> Self {
        Self { latency: 0.4, battery: 0.3, quality: 0.3 }
    }
}

/// Top-level Constellation facade.
#[derive(Debug)]
pub struct Constellation {
    inner: Arc<Mutex<ConstellationInner>>,
}

#[derive(Debug, Default)]
struct ConstellationInner {
    backends: HashMap<Backend, BackendInfo>,
    health: HashMap<Backend, HealthStatus>,
    thermal_multiplier: f32,
    weights: ScoringWeights,
}

impl Constellation {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(ConstellationInner {
                thermal_multiplier: 1.0,
                weights: ScoringWeights::default(),
                ..Default::default()
            })),
        }
    }

    pub fn register_backend(&self, info: BackendInfo) {
        let mut inner = self.inner.lock().expect("constellation mutex poisoned");
        inner.backends.insert(info.backend, info);
    }

    pub fn set_health(&self, status: HealthStatus) {
        let mut inner = self.inner.lock().expect("constellation mutex poisoned");
        inner.health.insert(status.backend, status);
    }

    pub fn set_thermal_multiplier(&self, m: f32) {
        let mut inner = self.inner.lock().expect("constellation mutex poisoned");
        inner.thermal_multiplier = m.clamp(0.5, 3.0);
    }

    pub fn set_weights(&self, w: ScoringWeights) -> Result<(), String> {
        let sum = w.latency + w.battery + w.quality;
        if (sum - 1.0).abs() > 0.001 {
            return Err(format!("weights must sum to 1.0, got {}", sum));
        }
        let mut inner = self.inner.lock().expect("constellation mutex poisoned");
        inner.weights = w;
        Ok(())
    }

    pub fn route(&self, req: &RoutingRequest) -> Result<RoutingDecision, RoutingError> {
        let inner = self.inner.lock().expect("constellation mutex poisoned");
        if inner.backends.is_empty() {
            return Err(RoutingError::NoBackendAvailable);
        }

        // Filter healthy
        let healthy: Vec<&BackendInfo> = inner.backends.values()
            .filter(|b| inner.health.get(&b.backend).map(|h| h.healthy).unwrap_or(true))
            .collect();
        if healthy.is_empty() {
            return Err(RoutingError::AllUnhealthy);
        }

        // Filter by require_local
        let require_local = req.require_local.unwrap_or(false);
        let candidates: Vec<&BackendInfo> = healthy.into_iter()
            .filter(|b| !require_local || b.backend.is_local())
            .collect();
        if candidates.is_empty() {
            return Err(RoutingError::NoBackendAvailable);
        }

        // Score each candidate
        let mut scored: Vec<(f32, &BackendInfo, BudgetEstimate)> = Vec::new();
        for info in &candidates {
            let estimate = estimate_budget(info, req, inner.thermal_multiplier);
            // Hard constraint check
            if let Some(budget) = &req.budget {
                if let Some(max_lat) = budget.max_latency_ms {
                    if estimate.latency_ms > max_lat { continue; }
                }
                if let Some(max_batt) = budget.max_battery_pct {
                    if estimate.battery_pct > max_batt { continue; }
                }
                if let Some(max_cost) = budget.max_cost_usd {
                    if estimate.cost_usd > max_cost { continue; }
                }
            }
            let latency_fit = 1.0 - (estimate.latency_ms as f32 / 1000.0).min(1.0);
            let battery_fit = 1.0 - (estimate.battery_pct / 5.0).min(1.0);
            let quality_fit = info.quality;
            let score = inner.weights.latency * latency_fit
                + inner.weights.battery * battery_fit
                + inner.weights.quality * quality_fit;
            scored.push((score, *info, estimate));
        }

        if scored.is_empty() {
            return Err(RoutingError::NoBackendAvailable);
        }

        // Sort by score descending
        scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
        let (winner_score, winner, winner_est) = scored[0];

        let alternatives = scored.iter().skip(1).take(3).map(|(s, info, _)| AlternativeDecision {
            backend: info.backend,
            model_id: info.default_model_id.clone(),
            score: *s,
            reason: format!("score={:.3}", s),
        }).collect();

        Ok(RoutingDecision {
            backend: winner.backend,
            model_id: winner.default_model_id.clone(),
            quantization: winner.default_quantization,
            estimated_latency_ms: winner_est.latency_ms,
            estimated_battery_pct: winner_est.battery_pct,
            estimated_cost_usd: winner_est.cost_usd,
            confidence: winner.quality,
            rationale: format!(
                "highest score {:.3} (latency={}ms, battery={:.3}%, quality={:.2})",
                winner_score, winner_est.latency_ms, winner_est.battery_pct, winner.quality
            ),
            alternatives,
        })
    }
}

fn estimate_budget(info: &BackendInfo, req: &RoutingRequest, thermal_mult: f32) -> BudgetEstimate {
    let baseline = match info.backend {
        Backend::QnnNpu => BudgetEstimate { latency_ms: 80, battery_pct: 0.4, cost_usd: 0.0, thermal: 0.2 },
        Backend::WebGpu => BudgetEstimate { latency_ms: 150, battery_pct: 0.8, cost_usd: 0.0, thermal: 0.4 },
        Backend::Cpu => BudgetEstimate { latency_ms: 500, battery_pct: 1.5, cost_usd: 0.0, thermal: 0.6 },
        Backend::Llamdrop => BudgetEstimate { latency_ms: 60, battery_pct: 0.3, cost_usd: 0.0, thermal: 0.1 },
        Backend::Cloud => BudgetEstimate { latency_ms: 300, battery_pct: 0.1, cost_usd: 0.002, thermal: 0.0 },
    };
    let prompt_len = req.prompt.len() as f32;
    let output_len = 256.0_f32;
    let len_factor = 1.0 + (prompt_len / 4096.0) + (output_len / 1024.0);
    BudgetEstimate {
        latency_ms: (baseline.latency_ms as f32 * len_factor * thermal_mult) as u32,
        battery_pct: baseline.battery_pct * len_factor,
        cost_usd: if info.backend == Backend::Cloud {
            ((prompt_len + output_len) / 1000.0) * baseline.cost_usd
        } else { 0.0 },
        thermal: (baseline.thermal * thermal_mult).min(1.0),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn default_backends() -> Vec<BackendInfo> {
        vec![
            BackendInfo {
                backend: Backend::QnnNpu,
                default_model_id: "gemma-2-9b-it-q4f16_1".to_string(),
                default_quantization: Quantization::Q4f16,
                quality: 0.85,
                tasks: vec![TaskKind::Reflex, TaskKind::Code, TaskKind::Math],
                capabilities: BackendCapabilities {
                    max_context_length: 8192,
                    supports_streaming: true,
                    supports_tools: false,
                    supports_json_mode: false,
                },
            },
            BackendInfo {
                backend: Backend::Cloud,
                default_model_id: "glm-5".to_string(),
                default_quantization: Quantization::Q0f32,
                quality: 0.95,
                tasks: vec![TaskKind::Planning, TaskKind::Code, TaskKind::Reasoning],
                capabilities: BackendCapabilities {
                    max_context_length: 128_000,
                    supports_streaming: true,
                    supports_tools: true,
                    supports_json_mode: true,
                },
            },
        ]
    }

    #[test]
    fn route_picks_local_when_required() {
        let c = Constellation::new();
        for b in default_backends() { c.register_backend(b); }
        let req = RoutingRequest {
            prompt: "hello".to_string(),
            budget: None,
            require_local: Some(true),
            task: None,
            min_confidence: None,
        };
        let decision = c.route(&req).expect("should route");
        assert!(decision.backend.is_local());
    }

    #[test]
    fn route_returns_no_backend_when_empty() {
        let c = Constellation::new();
        let req = RoutingRequest {
            prompt: "hello".to_string(),
            budget: None,
            require_local: None,
            task: None,
            min_confidence: None,
        };
        assert!(matches!(c.route(&req), Err(RoutingError::NoBackendAvailable)));
    }

    #[test]
    fn route_respects_latency_budget() {
        let c = Constellation::new();
        for b in default_backends() { c.register_backend(b); }
        let req = RoutingRequest {
            prompt: "hello".to_string(),
            budget: Some(Budget { max_latency_ms: Some(50), max_battery_pct: None, max_cost_usd: None, max_thermal: None }),
            require_local: Some(true),
            task: None,
            min_confidence: None,
        };
        // Llamdrop would be 60ms (baseline), QNN is 80ms — both over 50ms.
        // Should return NoBackendAvailable.
        assert!(matches!(c.route(&req), Err(RoutingError::NoBackendAvailable)));
    }
}
