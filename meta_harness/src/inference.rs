//! Inference Backend — the ONLY path to Gemma 2B and FABLE 12B.
//!
//! CRITICAL INVARIANT: AVA007 NEVER calls `fetch()` directly to llama-server.
//! Every inference call goes through this trait. This lets the Meta Harness:
//!
//!   1. Enforce budget checks before every call
//!   2. Log every call as a Receipt (audit trail)
//!   3. Inject Context Ocean context before the user query
//!   4. Apply thermal backoff (smaller batch, lower max_tokens)
//!   5. Retry on transient failures (with exponential backoff)
//!   6. Switch backends transparently (Gemma 2B ↔ FABLE 12B)
//!
//! Two concrete implementations:
//!   - `LlamaServerBackend`: HTTP to localhost:8080 (Gemma 2B)
//!   - `FableBackend`: loads Gemma 4 12B on-demand via @mlc-ai/web-llm
//!     (only when a FABLE route Decision is taken)
//!
//! Both speak the OpenAI-compatible API surface, but we wrap them so
//! the Meta Harness can intercept.

use std::sync::Arc;
use std::time::{Duration, Instant};

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use crate::policy::ModelChoice;

/// Request to the inference backend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InferenceRequest {
    /// The prompt. May include injected context prefix already.
    pub prompt: Arc<str>,

    /// Max tokens to generate.
    pub max_tokens: u32,

    /// Sampling temperature [0.0, 2.0]. 0 = greedy.
    pub temperature: f32,

    /// Nucleus sampling threshold.
    pub top_p: f32,

    /// Stop sequences (early-exit tokens).
    pub stop_tokens: Vec<Arc<str>>,

    /// Which model to use.
    pub model: ModelChoice,
}

/// Response from the inference backend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InferenceResponse {
    /// Generated text (excluding the prompt).
    pub text: Arc<str>,

    /// Number of tokens actually generated.
    pub tokens_generated: u32,

    /// Wall-clock latency in milliseconds.
    pub latency_ms: u32,
}

/// The trait every backend implements.
#[async_trait]
pub trait InferenceBackend: Send + Sync {
    async fn generate(&self, req: InferenceRequest) -> anyhow::Result<InferenceResponse>;

    /// Whether this backend is currently available (model loaded).
    async fn is_available(&self) -> bool;

    /// Human-readable name for logging.
    fn name(&self) -> &'static str;
}

// ── LlamaServerBackend ──────────────────────────────────────────────────────
// Production backend for Gemma 2B. Connects to llama-server on localhost:8080
// using the OpenAI-compatible /v1/chat/completions endpoint.

pub struct LlamaServerBackend {
    client: reqwest::Client,
    base_url: Arc<str>,
    timeout: Duration,
}

impl LlamaServerBackend {
    pub fn new(base_url: &str, timeout_ms: u64) -> Arc<Self> {
        Arc::new(Self {
            client: reqwest::Client::builder()
                .timeout(Duration::from_millis(timeout_ms))
                .build()
                .expect("reqwest client"),
            base_url: base_url.into(),
            timeout: Duration::from_millis(timeout_ms),
        })
    }

    /// Default: http://127.0.0.1:8080/v1
    pub fn default_for_device() -> Arc<Self> {
        Self::new("http://127.0.0.1:8080/v1", 30_000)
    }
}

#[async_trait]
impl InferenceBackend for LlamaServerBackend {
    async fn generate(&self, req: InferenceRequest) -> anyhow::Result<InferenceResponse> {
        let start = Instant::now();

        // OpenAI-compatible chat completions payload
        let payload = serde_json::json!({
            "model": "gemma-2b",
            "messages": [
                {"role": "user", "content": req.prompt.as_ref()}
            ],
            "max_tokens": req.max_tokens,
            "temperature": req.temperature,
            "top_p": req.top_p,
            "stream": false,
            "stop": req.stop_tokens,
        });

        let url = format!("{}/chat/completions", self.base_url);
        let resp = self.client
            .post(&url)
            .json(&payload)
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("llama-server {status}: {body}");
        }

        let body: serde_json::Value = resp.json().await?;
        let text = body["choices"][0]["message"]["content"]
            .as_str()
            .unwrap_or("")
            .to_string();

        let tokens_generated = body["usage"]["completion_tokens"]
            .as_u64()
            .unwrap_or(0) as u32;

        let latency_ms = start.elapsed().as_millis() as u32;

        Ok(InferenceResponse {
            text: text.into(),
            tokens_generated,
            latency_ms,
        })
    }

    async fn is_available(&self) -> bool {
        // Health check — try a HEAD request to /health
        let url = format!("{}/../health", self.base_url);
        self.client.head(&url).send().await
            .map(|r| r.status().is_success())
            .unwrap_or(false)
    }

    fn name(&self) -> &'static str {
        "llama-server (Gemma 2B)"
    }
}

// ── FableBackend ────────────────────────────────────────────────────────────
// On-demand loader for Gemma 4 12B agentic finetune. In production this
// would talk to a separate llama-server instance (port 8081) that's only
// spawned when a FABLE Decision is taken. For now we stub the loader.

pub struct FableBackend {
    client: reqwest::Client,
    base_url: Arc<str>,
    loaded: tokio::sync::Mutex<bool>,
}

impl FableBackend {
    pub fn new(base_url: &str) -> Arc<Self> {
        Arc::new(Self {
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(120))
                .build()
                .expect("reqwest client"),
            base_url: base_url.into(),
            loaded: tokio::sync::Mutex::new(false),
        })
    }

    pub fn default_for_device() -> Arc<Self> {
        Self::new("http://127.0.0.1:8081/v1")
    }

    /// Idempotent — only loads if not already loaded.
    pub async fn ensure_loaded(&self) -> anyhow::Result<()> {
        let mut loaded = self.loaded.lock().await;
        if *loaded {
            return Ok(());
        }
        // In production: spawn `llama-server --model fable-12b.gguf --port 8081`
        // For now we just probe the health endpoint.
        let url = format!("{}/../health", self.base_url);
        let resp = self.client.head(&url).send().await?;
        if !resp.status().is_success() {
            anyhow::bail!("FABLE server not running on {}", self.base_url);
        }
        *loaded = true;
        Ok(())
    }
}

#[async_trait]
impl InferenceBackend for FableBackend {
    async fn generate(&self, req: InferenceRequest) -> anyhow::Result<InferenceResponse> {
        self.ensure_loaded().await?;

        let start = Instant::now();
        let payload = serde_json::json!({
            "model": "fable-12b",
            "messages": [
                {"role": "system", "content": "You are FABLE, a planning agent. Decompose the user's request into a sequence of concrete steps. Output as a numbered list."},
                {"role": "user", "content": req.prompt.as_ref()}
            ],
            "max_tokens": req.max_tokens,
            "temperature": req.temperature,
            "top_p": req.top_p,
            "stream": false,
            "stop": req.stop_tokens,
        });

        let url = format!("{}/chat/completions", self.base_url);
        let resp = self.client.post(&url).json(&payload).send().await?;

        if !resp.status().is_success() {
            anyhow::bail!("FABLE server error: {}", resp.status());
        }

        let body: serde_json::Value = resp.json().await?;
        let text = body["choices"][0]["message"]["content"]
            .as_str()
            .unwrap_or("")
            .to_string();

        let tokens_generated = body["usage"]["completion_tokens"]
            .as_u64()
            .unwrap_or(0) as u32;

        Ok(InferenceResponse {
            text: text.into(),
            tokens_generated,
            latency_ms: start.elapsed().as_millis() as u32,
        })
    }

    async fn is_available(&self) -> bool {
        *self.loaded.lock().await
    }

    fn name(&self) -> &'static str {
        "FABLE (Gemma 4 12B agentic)"
    }
}

// ── RoutedBackend — picks Gemma or FABLE based on ModelChoice ───────────────
// This is what the Meta Harness actually holds. It dispatches to the
// right concrete backend based on the Decision's model field.

pub struct RoutedBackend {
    gemma: Arc<dyn InferenceBackend>,
    fable: Arc<dyn InferenceBackend>,
}

impl RoutedBackend {
    pub fn new(gemma: Arc<dyn InferenceBackend>, fable: Arc<dyn InferenceBackend>) -> Arc<Self> {
        Arc::new(Self { gemma, fable })
    }

    pub fn default_for_device() -> Arc<Self> {
        Self::new(
            LlamaServerBackend::default_for_device(),
            FableBackend::default_for_device(),
        )
    }
}

#[async_trait]
impl InferenceBackend for RoutedBackend {
    async fn generate(&self, req: InferenceRequest) -> anyhow::Result<InferenceResponse> {
        match req.model {
            ModelChoice::Gemma2B => self.gemma.generate(req).await,
            ModelChoice::Fable12B => self.fable.generate(req).await,
            ModelChoice::None => Err(anyhow::anyhow!("ModelChoice::None cannot generate")),
        }
    }

    async fn is_available(&self) -> bool {
        // Routed backend is "available" if at least Gemma is up
        self.gemma.is_available().await
    }

    fn name(&self) -> &'static str {
        "RoutedBackend (Gemma + FABLE)"
    }
}

// ── MockBackend (for tests) ─────────────────────────────────────────────────

pub struct MockBackend {
    responses: tokio::sync::Mutex<std::collections::VecDeque<InferenceResponse>>,
}

impl MockBackend {
    pub fn new(responses: Vec<InferenceResponse>) -> Self {
        Self {
            responses: tokio::sync::Mutex::new(responses.into()),
        }
    }
}

#[async_trait]
impl InferenceBackend for MockBackend {
    async fn generate(&self, _req: InferenceRequest) -> anyhow::Result<InferenceResponse> {
        let mut q = self.responses.lock().await;
        q.pop_front()
            .ok_or_else(|| anyhow::anyhow!("MockBackend exhausted"))
    }

    async fn is_available(&self) -> bool { true }
    fn name(&self) -> &'static str { "MockBackend" }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn routed_picks_gemma_for_gemma_choice() {
        let gemma = Arc::new(MockBackend::new(vec![
            InferenceResponse { text: "gemma response".into(), tokens_generated: 5, latency_ms: 100 },
        ]));
        let fable = Arc::new(MockBackend::new(vec![
            InferenceResponse { text: "fable response".into(), tokens_generated: 5, latency_ms: 100 },
        ]));
        let routed = RoutedBackend::new(gemma, fable);

        let resp = routed.generate(InferenceRequest {
            prompt: "test".into(),
            max_tokens: 16,
            temperature: 0.1,
            top_p: 0.9,
            stop_tokens: vec![],
            model: ModelChoice::Gemma2B,
        }).await.unwrap();

        assert_eq!(resp.text.as_ref(), "gemma response");
    }

    #[tokio::test]
    async fn routed_picks_fable_for_fable_choice() {
        let gemma = Arc::new(MockBackend::new(vec![
            InferenceResponse { text: "gemma".into(), tokens_generated: 1, latency_ms: 1 },
        ]));
        let fable = Arc::new(MockBackend::new(vec![
            InferenceResponse { text: "fable plan".into(), tokens_generated: 100, latency_ms: 8000 },
        ]));
        let routed = RoutedBackend::new(gemma, fable);

        let resp = routed.generate(InferenceRequest {
            prompt: "plan a trip".into(),
            max_tokens: 2048,
            temperature: 0.3,
            top_p: 0.95,
            stop_tokens: vec![],
            model: ModelChoice::Fable12B,
        }).await.unwrap();

        assert_eq!(resp.text.as_ref(), "fable plan");
    }
}
