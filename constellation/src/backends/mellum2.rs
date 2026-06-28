//! Mellum2 Backend — Executive tier (MoE LLM via local Ollama)
//!
//! Ported from `files(8)/executive.ts` (white paper §3, L6 Executive tier).
//!
//! Mellum2 is a Mixture-of-Experts model (12B total / 2.5B active params)
//! running locally via Ollama. Used for routing + planning decisions
//! that don't require Mercury2's diffusion depth.
//!
//! # Configuration
//!
//! Reads from env vars (matching `.env`):
//!   MELLUM2_ENDPOINT — http://localhost:11434/api/generate
//!   MELLUM2_MODEL    — mellum2 (Ollama model name)

use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tracing::{info, warn};

use crate::model::{ModelConfig, ModelEndpoint, Quantization};

/// Mellum2 model configuration.
pub fn mellum2_config() -> ModelConfig {
    ModelConfig {
        id: crate::model::ModelId::Custom("Mellum2".into()),
        endpoint: ModelEndpoint::Local { port: 11434 },
        quantization: Quantization::Q4KM,
        always_loaded: false,
        load_time_ms: 1500,
        avg_latency_ms: 150,
        max_context_tokens: 8192,
        cost_per_1k_tokens: 0.0, // local
        capabilities: vec!["routing".into(), "planning".into(), "escalation".into()],
    }
}

/// Ollama API request (Mellum2 runs via Ollama).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OllamaRequest {
    pub model: String,
    pub prompt: String,
    pub stream: bool,
    pub options: OllamaOptions,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OllamaOptions {
    pub temperature: f32,
    pub num_predict: u32,
}

/// Ollama API response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OllamaResponse {
    pub model: String,
    pub response: String,
    pub done: bool,
    pub total_duration: u64,
    pub load_duration: u64,
    pub prompt_eval_count: u32,
    pub eval_count: u32,
}

/// The Mellum2 backend client (via Ollama).
pub struct Mellum2Backend {
    http: reqwest::Client,
    endpoint: String,
    model: String,
}

impl Mellum2Backend {
    pub fn new() -> Arc<Self> {
        let endpoint = std::env::var("MELLUM2_ENDPOINT")
            .unwrap_or_else(|_| "http://localhost:11434/api/generate".into());
        let model = std::env::var("MELLUM2_MODEL")
            .unwrap_or_else(|_| "mellum2".into());

        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .expect("reqwest client");

        Arc::new(Self { http, endpoint, model })
    }

    /// Generate a response using Mellum2 (via Ollama).
    pub async fn generate(&self, prompt: &str, max_tokens: u32) -> anyhow::Result<String> {
        let req = OllamaRequest {
            model: self.model.clone(),
            prompt: prompt.into(),
            stream: false,
            options: OllamaOptions {
                temperature: 0.4,
                num_predict: max_tokens,
            },
        };

        info!("Mellum2 generate (model={}, max_tokens={})", self.model, max_tokens);

        let resp = self.http
            .post(&self.endpoint)
            .json(&req)
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("Mellum2/Ollama API error {}: {}", status, body);
        }

        let body: OllamaResponse = resp.json().await?;
        info!("Mellum2 response: {} tokens in {}ms",
              body.eval_count,
              body.total_duration / 1_000_000);

        Ok(body.response)
    }

    /// Check if Ollama is running and the model is available.
    pub async fn is_available(&self) -> bool {
        // Health check: GET /api/tags → list of installed models
        let tags_url = self.endpoint.replace("/api/generate", "/api/tags");
        match self.http.get(&tags_url).send().await {
            Ok(resp) => {
                if !resp.status().is_success() {
                    return false;
                }
                // Check if mellum2 model is in the list
                if let Ok(body) = resp.json::<serde_json::Value>().await {
                    if let Some(models) = body["models"].as_array() {
                        return models.iter().any(|m| {
                            m["name"].as_str()
                                .map(|n| n.starts_with(&self.model))
                                .unwrap_or(false)
                        });
                    }
                }
                false
            }
            Err(_) => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_reads_env_vars() {
        let cfg = mellum2_config();
        assert!(matches!(cfg.id, crate::model::ModelId::Custom(_)));
        assert!(matches!(cfg.endpoint, ModelEndpoint::Local { .. }));
    }
}
