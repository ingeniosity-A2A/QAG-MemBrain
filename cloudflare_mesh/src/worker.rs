//! Cloudflare Worker client — egress proxy for Telnyx API calls.

use std::sync::Arc;
use std::time::Duration;

use parking_lot::RwLock;
use serde::{Deserialize, Serialize};

use crate::CloudflareConfig;

/// HTTP client that talks to the Cloudflare Worker proxy.
pub struct WorkerClient {
    config: Arc<CloudflareConfig>,
    http: reqwest::Client,
    /// Per-device rate limit (set by the Worker, cached locally)
    rate_limit: RwLock<Option<WorkerRateLimit>>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct WorkerRateLimit {
    pub requests_per_min: u32,
    pub remaining: u32,
    pub reset_at_unix: i64,
}

impl WorkerClient {
    pub fn new(config: Arc<CloudflareConfig>) -> anyhow::Result<Self> {
        let http = reqwest::Client::builder()
            .timeout(config.timeout)
            .user_agent("AVA007-CloudflareMesh/0.1")
            .build()?;
        Ok(Self {
            config,
            http,
            rate_limit: RwLock::new(None),
        })
    }

    /// Register the device's tunnel URL with the Worker.
    /// The Worker stores this in KV and uses it to forward webhooks.
    pub async fn register_tunnel(&self, tunnel_url: &str) -> anyhow::Result<()> {
        let url = format!("{}/admin/tunnel", self.config.worker_url);

        let resp = self.http
            .post(&url)
            .header("X-Webhook-Secret", &*self.config.webhook_secret)
            .json(&serde_json::json!({ "tunnel_url": tunnel_url }))
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("Worker register_tunnel failed {}: {}", status, body);
        }

        tracing::info!("Registered tunnel URL {} with Worker", tunnel_url);
        Ok(())
    }

    /// Health check the Worker.
    pub async fn health(&self) -> anyhow::Result<bool> {
        let url = format!("{}/health", self.config.worker_url);
        let resp = self.http.get(&url).send().await?;
        Ok(resp.status().is_success())
    }

    /// Get the cached rate limit info.
    pub fn rate_limit(&self) -> Option<WorkerRateLimit> {
        self.rate_limit.read().clone()
    }

    pub(crate) fn update_rate_limit(&self, info: WorkerRateLimit) {
        *self.rate_limit.write() = Some(info);
    }

    /// Get the Worker URL (for the Telnyx client to use as base_url).
    pub fn worker_url(&self) -> &str {
        &self.config.worker_url
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    #[tokio::test]
    async fn register_tunnel_posts_to_admin_endpoint() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/admin/tunnel"))
            .respond_with(ResponseTemplate::new(200))
            .mount(&server)
            .await;

        let cfg = Arc::new(CloudflareConfig {
            worker_url: server.uri().into(),
            webhook_secret: "test_secret".into(),
            ..Default::default()
        });
        let client = WorkerClient::new(cfg).unwrap();
        let result = client.register_tunnel("https://abc.cfargotunnel.com").await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn health_returns_true_on_200() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/health"))
            .respond_with(ResponseTemplate::new(200))
            .mount(&server)
            .await;

        let cfg = Arc::new(CloudflareConfig {
            worker_url: server.uri().into(),
            ..Default::default()
        });
        let client = WorkerClient::new(cfg).unwrap();
        assert!(client.health().await.unwrap());
    }

    #[tokio::test]
    async fn health_returns_false_on_500() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/health"))
            .respond_with(ResponseTemplate::new(500))
            .mount(&server)
            .await;

        let cfg = Arc::new(CloudflareConfig {
            worker_url: server.uri().into(),
            ..Default::default()
        });
        let client = WorkerClient::new(cfg).unwrap();
        assert!(!client.health().await.unwrap());
    }
}
