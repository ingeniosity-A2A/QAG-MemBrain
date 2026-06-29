//! Model types — ModelId, ModelEndpoint, Quantization, ModelConfig, ModelAssignment.

use serde::{Deserialize, Serialize};

/// Identifier for a known model in the Constellation registry.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ModelId {
    Gemma2B,
    Gemma12B,
    Embedding384,
    Claude,
    GPT4o,
    Qwen7B,
    /// Mercury2 diffusion LLM (Inception Labs) — Cortex tier
    Mercury2,
    /// Mellum2 MoE (local Ollama) — Executive tier
    Mellum2,
    Custom(String),
}

impl ModelId {
    pub fn as_str(&self) -> &str {
        match self {
            ModelId::Gemma2B => "gemma-2b",
            ModelId::Gemma12B => "gemma-12b",
            ModelId::Embedding384 => "embedding-384",
            ModelId::Claude => "claude",
            ModelId::GPT4o => "gpt-4o",
            ModelId::Qwen7B => "qwen-7b",
            ModelId::Mercury2 => "mercury-2",
            ModelId::Mellum2 => "mellum-2",
            ModelId::Custom(s) => s.as_str(),
        }
    }
}

/// Where a model lives.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ModelEndpoint {
    /// llama-server on localhost
    Local { port: u16 },
    /// On-device NPU (QNN/Hexagon — future, not currently used)
    NPU { backend: String },
    /// Remote API (e.g. Anthropic, OpenAI)
    Cloud { api_url: String, api_key_env: String },
}

/// Quantization scheme. Cloud = managed by provider.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Quantization {
    Q3K,
    Q4KM,
    Q5KM,
    Q8,
    FP16,
    Cloud,
}

impl Quantization {
    pub fn as_str(self) -> &'static str {
        match self {
            Quantization::Q3K => "Q3_K",
            Quantization::Q4KM => "Q4_K_M",
            Quantization::Q5KM => "Q5_K_M",
            Quantization::Q8 => "Q8",
            Quantization::FP16 => "FP16",
            Quantization::Cloud => "cloud",
        }
    }
}

/// Static configuration of a model in the registry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelConfig {
    pub id: ModelId,
    pub endpoint: ModelEndpoint,
    pub quantization: Quantization,
    /// Always loaded in memory (Gemma 2B, Embedding). On-demand models
    /// incur a load_time_ms penalty on first use.
    pub always_loaded: bool,
    /// Time to load the model if not always_loaded
    pub load_time_ms: u64,
    /// Average inference latency
    pub avg_latency_ms: u64,
    /// Maximum input context window
    pub max_context_tokens: u32,
    /// Cost per 1k tokens (0.0 for local, > 0 for cloud)
    pub cost_per_1k_tokens: f64,
    /// Capabilities this model can serve
    pub capabilities: Vec<String>,
}

/// The output of Constellation.routing — what model to use for this request.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelAssignment {
    pub model: ModelId,
    pub endpoint: ModelEndpoint,
    pub timeout_ms: u64,
    pub fallback: Option<Box<ModelAssignment>>,
    pub quantization: Quantization,
    /// Human-readable explanation of why this model was chosen
    pub reasoning: String,
}
