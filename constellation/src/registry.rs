//! Default model registry for AVA007.
//!
//! These are the canonical models the Constellation knows about on a
//! fresh AVA007 install. Devices may add Custom entries at runtime.

use crate::model::*;

/// Returns the default Constellation model registry.
///
/// Six models by default:
///   - Gemma 2B (always loaded, Q4_K_M, ~80ms, port 8080)
///   - Gemma 4 12B (on-demand, Q4_K_M, ~2s, port 8081)
///   - Embedding 384 (always loaded, FP16, ~15ms, port 8082)
///   - Claude (cloud fallback for complex reasoning)
///   - GPT-4o (cloud fallback for tool use)
///   - Qwen 2.5 7B (on-demand, Q4_K_M, ~150ms, port 8083, multilang)
pub fn default_registry() -> Vec<ModelConfig> {
    vec![
        ModelConfig {
            id: ModelId::Gemma2B,
            endpoint: ModelEndpoint::Local { port: 8080 },
            quantization: Quantization::Q4KM,
            always_loaded: true,
            load_time_ms: 0,
            avg_latency_ms: 80,
            max_context_tokens: 4096,
            cost_per_1k_tokens: 0.0,
            capabilities: vec![
                "Question".into(), "Chitchat".into(), "UiNavigation".into(),
                "MemoryOp".into(), "WhatsApp".into(),
            ],
        },
        ModelConfig {
            id: ModelId::Gemma12B,
            endpoint: ModelEndpoint::Local { port: 8081 },
            quantization: Quantization::Q4KM,
            always_loaded: false,
            load_time_ms: 3000,
            avg_latency_ms: 2000,
            max_context_tokens: 8192,
            cost_per_1k_tokens: 0.0,
            capabilities: vec![
                "Planning".into(), "Synthesis".into(),
            ],
        },
        ModelConfig {
            id: ModelId::Embedding384,
            endpoint: ModelEndpoint::Local { port: 8082 },
            quantization: Quantization::FP16,
            always_loaded: true,
            load_time_ms: 0,
            avg_latency_ms: 15,
            max_context_tokens: 512,
            cost_per_1k_tokens: 0.0,
            capabilities: vec!["Embedding".into(), "VSS".into()],
        },
        ModelConfig {
            id: ModelId::Claude,
            endpoint: ModelEndpoint::Cloud {
                api_url: "https://api.anthropic.com/v1/messages".into(),
                api_key_env: "ANTHROPIC_API_KEY".into(),
            },
            quantization: Quantization::Cloud,
            always_loaded: false,
            load_time_ms: 0,
            avg_latency_ms: 2000,
            max_context_tokens: 200_000,
            cost_per_1k_tokens: 0.015,
            capabilities: vec!["Planning".into(), "Synthesis".into(), "Reasoning".into()],
        },
        ModelConfig {
            id: ModelId::GPT4o,
            endpoint: ModelEndpoint::Cloud {
                api_url: "https://api.openai.com/v1/chat/completions".into(),
                api_key_env: "OPENAI_API_KEY".into(),
            },
            quantization: Quantization::Cloud,
            always_loaded: false,
            load_time_ms: 0,
            avg_latency_ms: 2000,
            max_context_tokens: 128_000,
            cost_per_1k_tokens: 0.005,
            capabilities: vec!["ToolUse".into(), "CodeExecution".into()],
        },
        ModelConfig {
            id: ModelId::Qwen7B,
            endpoint: ModelEndpoint::Local { port: 8083 },
            quantization: Quantization::Q4KM,
            always_loaded: false,
            load_time_ms: 1500,
            avg_latency_ms: 150,
            max_context_tokens: 4096,
            cost_per_1k_tokens: 0.0,
            capabilities: vec!["Translate".into(), "Multilang".into()],
        },
        // Mercury2 — Cortex tier (diffusion LLM, Inception Labs)
        ModelConfig {
            id: ModelId::Mercury2,
            endpoint: ModelEndpoint::Cloud {
                api_url: std::env::var("MERCURY2_ENDPOINT")
                    .unwrap_or_else(|_| "https://api.inceptionlabs.ai/v1/chat/completions".into()),
                api_key_env: "MERCURY2_API_KEY".into(),
            },
            quantization: Quantization::Cloud,
            always_loaded: false,
            load_time_ms: 0,
            avg_latency_ms: 2000,
            max_context_tokens: 32_768,
            cost_per_1k_tokens: 0.002,
            capabilities: vec!["deep_reasoning".into(), "policy".into(), "novel_types".into()],
        },
        // Mellum2 — Executive tier (MoE 12B/2.5B active, local Ollama)
        ModelConfig {
            id: ModelId::Mellum2,
            endpoint: ModelEndpoint::Local { port: 11434 },
            quantization: Quantization::Q4KM,
            always_loaded: false,
            load_time_ms: 1500,
            avg_latency_ms: 150,
            max_context_tokens: 8192,
            cost_per_1k_tokens: 0.0,
            capabilities: vec!["routing".into(), "planning".into(), "escalation".into()],
        },
    ]
}
