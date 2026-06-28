//! Mercury2 Backend — Cortex tier (diffusion LLM)
//!
//! Ported from `files(8)/cortex.ts` (white paper §3, L6 Cortex tier).
//!
//! Mercury 2 is a diffusion-based LLM from Inception Labs. Unlike
//! autoregressive models, it generates the complete output as a block
//! over parallel diffusion passes — flat latency regardless of length.
//!
//! Constraint: context must be COMPLETE before the call. No mid-call
//! steering. Output arrives as a block, not a token stream.
//!
//! # Configuration
//!
//! Reads from env vars (matching `.env`):
//!   MERCURY2_ENDPOINT — https://api.inceptionlabs.ai/v1/chat/completions
//!   MERCURY2_API_KEY  — sk-... (from dashboard.inceptionlabs.ai)
//!   MERCURY2_MODEL    — mercury-coder-small (default)

use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tracing::{info, warn};

use crate::model::{ModelConfig, ModelEndpoint, Quantization};
use crate::signals::RoutingSignals;

/// Mercury2 model configuration.
pub fn mercury2_config() -> ModelConfig {
    ModelConfig {
        id: crate::model::ModelId::Custom("Mercury2".into()),
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
    }
}

/// Request to the Mercury2 diffusion API.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Mercury2Request {
    pub model: String,
    pub messages: Vec<Mercury2Message>,
    pub max_tokens: u32,
    pub temperature: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Mercury2Message {
    pub role: String,
    pub content: String,
}

/// Mercury2 response — arrives as a single block (not a token stream).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Mercury2Response {
    pub id: String,
    pub choices: Vec<Mercury2Choice>,
    pub usage: Mercury2Usage,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Mercury2Choice {
    pub message: Mercury2Message,
    pub finish_reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Mercury2Usage {
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
}

/// The Mercury2 backend client.
pub struct Mercury2Backend {
    http: reqwest::Client,
    endpoint: String,
    api_key: String,
    model: String,
}

impl Mercury2Backend {
    pub fn new() -> Arc<Self> {
        let endpoint = std::env::var("MERCURY2_ENDPOINT")
            .unwrap_or_else(|_| "https://api.inceptionlabs.ai/v1/chat/completions".into());
        let api_key = std::env::var("MERCURY2_API_KEY").unwrap_or_default();
        let model = std::env::var("MERCURY2_MODEL")
            .unwrap_or_else(|_| "mercury-coder-small".into());

        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(60)) // diffusion can be slow
            .build()
            .expect("reqwest client");

        Arc::new(Self { http, endpoint, api_key, model })
    }

    /// Generate a response using Mercury2 diffusion.
    ///
    /// The prompt must be COMPLETE — Mercury 2 refines in parallel passes
    /// and cannot be steered mid-call. Output arrives as a block.
    pub async fn generate(&self, prompt: &str, max_tokens: u32) -> anyhow::Result<String> {
        if self.api_key.is_empty() {
            anyhow::bail!("MERCURY2_API_KEY not set — get one at https://dashboard.inceptionlabs.ai/");
        }

        let req = Mercury2Request {
            model: self.model.clone(),
            messages: vec![Mercury2Message {
                role: "user".into(),
                content: prompt.into(),
            }],
            max_tokens,
            temperature: 0.7,
        };

        info!("Mercury2 generate (model={}, max_tokens={})", self.model, max_tokens);

        let resp = self.http
            .post(&self.endpoint)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("Content-Type", "application/json")
            .json(&req)
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("Mercury2 API error {}: {}", status, body);
        }

        let body: Mercury2Response = resp.json().await?;
        let text = body.choices.first()
            .map(|c| c.message.content.clone())
            .unwrap_or_default();

        info!("Mercury2 response: {} tokens generated", body.usage.completion_tokens);
        Ok(text)
    }

    /// Check if the backend is available (API key configured).
    pub fn is_available(&self) -> bool {
        !self.api_key.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_reads_env_vars() {
        // Just verify the config builder doesn't panic
        let cfg = mercury2_config();
        assert!(matches!(cfg.id, crate::model::ModelId::Custom(_)));
    }

    #[test]
    fn backend_builds_without_key() {
        std::env::remove_var("MERCURY2_API_KEY");
        let backend = Mercury2Backend::new();
        assert!(!backend.is_available());
    }
}
