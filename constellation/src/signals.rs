//! Routing signals — the inputs Constellation uses to make decisions.

use serde::{Deserialize, Serialize};

/// All the signals Constellation considers when picking a model.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoutingSignals {
    /// Intent bucket from the REV.IKE classifier (Question, Synthesis, Planning, etc.)
    pub intent_bucket: String,
    /// Classifier confidence (0.0–1.0)
    pub confidence: f32,
    /// Estimated input tokens
    pub estimated_tokens: u32,
    /// Battery level (0.0–1.0)
    pub battery_pct: f32,
    /// Thermal state
    pub thermal: ThermalState,
    /// Network connectivity
    pub connectivity: Connectivity,
    /// Max latency the user is willing to wait (None = no constraint)
    pub latency_budget_ms: Option<u64>,
    /// Session budget remaining (tokens)
    pub session_budget_remaining: u64,
    /// Whether the request requires tool use (expands candidate set)
    pub requires_tools: bool,
}

impl Default for RoutingSignals {
    fn default() -> Self {
        Self {
            intent_bucket: "Question".into(),
            confidence: 0.7,
            estimated_tokens: 256,
            battery_pct: 0.8,
            thermal: ThermalState::Normal,
            connectivity: Connectivity::Connected,
            latency_budget_ms: Some(5000),
            session_budget_remaining: 50_000,
            requires_tools: false,
        }
    }
}

/// Device thermal state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ThermalState {
    Normal,
    Warm,
    Critical,
}

impl Default for ThermalState {
    fn default() -> Self {
        ThermalState::Normal
    }
}

/// Network connectivity.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Connectivity {
    /// Full internet access
    Connected,
    /// Limited / slow / metered
    Degraded,
    /// No internet
    Offline,
}

impl Default for Connectivity {
    fn default() -> Self {
        Connectivity::Connected
    }
}
