use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ─────────────────────────────────────────────
//  The HarnessProcessor trait
//  Every harness component implements this.
//  Processors are serializable, versionable, swappable.
// ─────────────────────────────────────────────

#[async_trait]
pub trait HarnessProcessor: Send + Sync + std::fmt::Debug {
    /// Unique slot name: "classifier", "injector", "router", "policy", etc.
    fn slot(&self) -> &str;

    /// Version of this specific implementation. Incremented on every evolution.
    fn version(&self) -> u32;

    /// Serialize the full configuration for storage in Context Ocean.
    fn config_snapshot(&self) -> ProcessorConfig;

    /// Process a receipt through this stage.
    async fn process(&self, input: ProcessorInput) -> ProcessorOutput;

    /// Self-assess confidence in this output.
    /// Returns 0.0–1.0. Used by Critic for calibration tracking.
    fn confidence(&self, input: &ProcessorInput, output: &ProcessorOutput) -> f32;

    /// Simulate: replay a historical trace through this processor.
    /// Default implementation just calls process().
    /// Override for deterministic replay (e.g., skip LLM calls, use cached outputs).
    async fn simulate(&self, input: ProcessorInput) -> ProcessorOutput {
        self.process(input).await
    }
}

// ─────────────────────────────────────────────
//  Processor configuration — serializable state
// ─────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessorConfig {
    pub slot: String,
    pub version: u32,
    /// SHA-256 of the processor's code + config. Detects drift.
    pub implementation_hash: String,
    /// Optional prompt template (for LLM-backed processors)
    pub prompt_template: Option<String>,
    /// Optional tool configuration (for GOOSE services)
    pub tool_config: Option<serde_json::Value>,
    /// Optional routing rules (for the router processor)
    pub routing_rules: Option<Vec<RoutingRule>>,
    /// Optional context strategies (for the injector processor)
    pub context_strategies: Option<Vec<ContextStrategy>>,
    /// When this version was created
    pub created_at: i64,
    /// Rolling average success rate (0.0–1.0)
    pub performance_score: f64,
    /// Total times this version has been invoked
    pub total_invocations: u64,
    /// Parent version (evolution lineage)
    pub parent_version: Option<u32>,
    /// The proposal ID that created this version
    pub origin_proposal_id: Option<String>,
}

impl ProcessorConfig {
    pub fn new(slot: &str, version: u32) -> Self {
        Self {
            slot: slot.to_string(),
            version,
            implementation_hash: String::new(),
            prompt_template: None,
            tool_config: None,
            routing_rules: None,
            context_strategies: None,
            created_at: chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0),
            performance_score: 0.0,
            total_invocations: 0,
            parent_version: None,
            origin_proposal_id: None,
        }
    }

    /// Compute a content hash of this configuration for drift detection.
    pub fn compute_hash(&self) -> String {
        use sha2::{Sha256, Digest};
        let serialized = serde_json::to_vec(self).unwrap_or_default();
        let hash = Sha256::digest(&serialized);
        format!("{:x}", hash)
    }
}

// ─────────────────────────────────────────────
//  Routing rules and context strategies
// ─────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoutingRule {
    pub intent: String,
    pub route: String,
    pub condition: Option<String>,
    pub priority: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextStrategy {
    pub name: String,
    pub weight: f32,
    pub max_tokens: u32,
    pub enabled: bool,
}

// ─────────────────────────────────────────────
//  Processor I/O types
// ─────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct ProcessorInput {
    /// The receipt being processed
    pub receipt: lite_notebook::Receipt,
    /// Accumulated context from prior processors in the chain
    pub accumulated_context: AccumulatedContext,
    /// Session metadata
    pub session_id: String,
    /// Budget remaining for this turn
    pub remaining_budget: BudgetSnapshot,
}

#[derive(Debug, Clone)]
pub struct AccumulatedContext {
    /// Classified intent (set by classifier processor)
    pub intent: Option<ClassifiedIntent>,
    /// Injection decisions (set by policy processor)
    pub decision: Option<InjectionDecision>,
    /// Injected context (set by injector processor)
    pub injected_context: Option<String>,
    /// Routing target (set by router processor)
    pub route_target: Option<String>,
    /// Raw data bag for processor-to-processor communication
    pub data: HashMap<String, serde_json::Value>,
}

impl AccumulatedContext {
    pub fn empty() -> Self {
        Self {
            intent: None,
            decision: None,
            injected_context: None,
            route_target: None,
            data: HashMap::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClassifiedIntent {
    pub bucket: String,
    pub confidence: f32,
    pub language: String,
    pub tokens: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InjectionDecision {
    pub mode: String, // "inject" or "expand"
    pub model: String,
    pub context_budget: u32,
    pub gen_budget: u32,
    pub latency_budget_ms: u64,
}

#[derive(Debug, Clone)]
pub struct BudgetSnapshot {
    pub tokens_used: u32,
    pub tokens_remaining: u32,
    pub session_elapsed_ms: u64,
    pub thermal_state: ThermalState,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ThermalState {
    Normal,
    Warm,
    Critical,
}

#[derive(Debug, Clone)]
pub struct ProcessorOutput {
    /// Modified accumulated context (passed to next processor)
    pub context: AccumulatedContext,
    /// Whether this processor wants to short-circuit the chain
    pub short_circuit: bool,
    /// Human-readable reason for the decision (for receipts)
    pub reason: String,
    /// Tokens consumed by this processor
    pub tokens_used: u32,
    /// Latency of this processor
    pub latency_ms: u64,
    /// Whether the output is considered successful
    pub success: bool,
}

impl ProcessorOutput {
    pub fn pass(context: AccumulatedContext, reason: &str) -> Self {
        Self {
            context,
            short_circuit: false,
            reason: reason.to_string(),
            tokens_used: 0,
            latency_ms: 0,
            success: true,
        }
    }

    pub fn short_circuit(context: AccumulatedContext, reason: &str) -> Self {
        Self {
            context,
            short_circuit: true,
            reason: reason.to_string(),
            tokens_used: 0,
            latency_ms: 0,
            success: true,
        }
    }

    pub fn failure(reason: &str) -> Self {
        Self {
            context: AccumulatedContext::empty(),
            short_circuit: true,
            reason: reason.to_string(),
            tokens_used: 0,
            latency_ms: 0,
            success: false,
        }
    }
}
