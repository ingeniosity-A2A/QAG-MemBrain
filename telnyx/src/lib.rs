//! Telnyx API client — WhatsApp messaging + calling.
//!
//! All endpoints hit `https://api.telnyx.com/v2/...` via HTTPS.
//! Knox-safe by construction: we never touch the device's own telephony
//! stack (modem/SIM/IMEI/EFS). We're just calling a cloud REST API.
//!
//! # Authentication
//!
//! Telnyx API keys are stored in the Android Keystore (production) or
//! `TELNYX_API_KEY` env var (dev/test). Never logged, never persisted
//! to disk in plaintext.
//!
//! # Audit
//!
//! Every API call produces a Receipt (Origin::Goose, kind::Action) that
//! gets deposited in the Context Ocean. The `knox_audit_log` view shows
//! these as Knox-safe (knox_safe=TRUE) because they're cloud API calls.

use std::sync::Arc;
use std::time::Duration;

use parking_lot::RwLock;
use serde::{Deserialize, Serialize};

pub mod whatsapp;
pub mod auth;
pub mod models;

pub use whatsapp::WhatsAppClient;
pub use auth::TelnyxAuth;
pub use models::*;

/// Configuration for the Telnyx client.
#[derive(Clone, Debug)]
pub struct TelnyxConfig {
    /// Base URL. Default: https://api.telnyx.com
    /// Override for testing (e.g. http://localhost:8080)
    pub base_url: Arc<str>,

    /// HTTP timeout (default 30s — Telnyx API can be slow under load)
    pub timeout: Duration,

    /// Optional Cloudflare Worker proxy URL.
    /// If set, all requests go through this Worker which:
    ///   1. Injects the Telnyx API key from Cloudflare secret store
    ///   2. Rate-limits per device
    ///   3. Logs to Cloudflare Analytics
    ///   4. Strips device IP from upstream request
    /// If None, requests go direct to Telnyx with the key from auth.
    pub cloudflare_proxy_url: Option<Arc<str>>,

    /// Default WhatsApp Business profile ID (Telnyx phone number ID).
    /// Override per-call if multiple numbers are configured.
    pub default_whatsapp_phone_id: Option<Arc<str>>,
}

impl Default for TelnyxConfig {
    fn default() -> Self {
        Self {
            base_url: "https://api.telnyx.com".into(),
            timeout: Duration::from_secs(30),
            cloudflare_proxy_url: None,
            default_whatsapp_phone_id: None,
        }
    }
}

/// Top-level Telnyx client. Holds the auth + config.
/// Cheap to clone (Arc internals).
#[derive(Clone)]
pub struct TelnyxClient {
    config: Arc<TelnyxConfig>,
    auth: Arc<TelnyxAuth>,
    http: reqwest::Client,
    /// Last API call's rate-limit headers (for diagnostics)
    last_rate_limit: Arc<RwLock<Option<RateLimitInfo>>>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RateLimitInfo {
    pub limit: u32,
    pub remaining: u32,
    pub reset_at_unix: i64,
}

impl TelnyxClient {
    pub fn new(config: TelnyxConfig, auth: TelnyxAuth) -> anyhow::Result<Arc<Self>> {
        let http = reqwest::Client::builder()
            .timeout(config.timeout)
            .user_agent("AVA007-Telnyx/0.1")
            .build()?;

        Ok(Arc::new(Self {
            config: Arc::new(config),
            auth: Arc::new(auth),
            http,
            last_rate_limit: Arc::new(RwLock::new(None)),
        }))
    }

    /// Get the WhatsApp client bound to this Telnyx instance.
    pub fn whatsapp(self: &Arc<Self>) -> Arc<WhatsAppClient> {
        WhatsAppClient::new(self.clone())
    }

    /// Build the actual request URL — uses Cloudflare proxy if configured.
    pub(crate) fn request_url(&self, path: &str) -> String {
        if let Some(proxy) = &self.config.cloudflare_proxy_url {
            format!("{}{}", proxy, path)
        } else {
            format!("{}{}", self.config.base_url, path)
        }
    }

    /// Inject the auth header. If using Cloudflare proxy, the proxy
    /// injects the actual Telnyx key from its secret store — we send
    /// a device-bound token instead.
    pub(crate) fn auth_header(&self) -> anyhow::Result<(String, String)> {
        if self.config.cloudflare_proxy_url.is_some() {
            // Cloudflare Worker path: send device token, Worker swaps for real key
            let token = self.auth.device_token()?;
            Ok(("X-Device-Token".into(), token))
        } else {
            // Direct path: send Telnyx API key
            let key = self.auth.api_key()?;
            Ok(("Authorization".into(), format!("Bearer {}", key)))
        }
    }

    pub(crate) fn http(&self) -> &reqwest::Client {
        &self.http
    }

    pub(crate) fn update_rate_limit(&self, info: RateLimitInfo) {
        *self.last_rate_limit.write() = Some(info);
    }

    pub fn rate_limit_info(&self) -> Option<RateLimitInfo> {
        self.last_rate_limit.read().clone()
    }

    pub fn config(&self) -> &TelnyxConfig {
        &self.config
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn make_client(server_url: &str) -> Arc<TelnyxClient> {
        let config = TelnyxConfig {
            base_url: server_url.into(),
            ..Default::default()
        };
        let auth = TelnyxAuth::from_env_static("test_key_abc123");
        TelnyxClient::new(config, auth).unwrap()
    }

    #[tokio::test]
    async fn client_builds_with_mock_server() {
        let server = MockServer::start().await;
        let client = make_client(&server.uri());
        assert!(client.config().base_url.as_ref().contains("127.0.0.1"));
    }

    #[tokio::test]
    async fn auth_header_uses_bearer_token_direct() {
        let server = MockServer::start().await;
        let client = make_client(&server.uri());
        let (k, v) = client.auth_header().unwrap();
        assert_eq!(k, "Authorization");
        assert_eq!(v, "Bearer test_key_abc123");
    }

    #[tokio::test]
    async fn auth_header_uses_device_token_via_proxy() {
        let config = TelnyxConfig {
            base_url: "https://api.telnyx.com".into(),
            cloudflare_proxy_url: Some("https://worker.example.workers.dev".into()),
            ..Default::default()
        };
        std::env::set_var("AVA007_DEVICE_TOKEN", "dev_token_xyz");
        let auth = TelnyxAuth::from_env_static("real_key_hidden");
        let client = TelnyxClient::new(config, auth).unwrap();
        let (k, v) = client.auth_header().unwrap();
        assert_eq!(k, "X-Device-Token");
        assert_eq!(v, "dev_token_xyz");
    }
}
