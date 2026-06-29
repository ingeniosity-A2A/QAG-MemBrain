//! Cloudflare mesh — secure egress + webhook ingress for AVA007.
//!
//! Three roles:
//!
//! 1. **Worker proxy** (egress): All Telnyx API calls go through a
//!    Cloudflare Worker at `https://<worker>.workers.dev`. The Worker:
//!      - Holds the real Telnyx API key in Cloudflare secret store
//!      - Receives `X-Device-Token` from AVA007, validates it
//!      - Injects `Authorization: Bearer <real_key>` on the upstream call
//!      - Rate-limits per device (KV counter)
//!      - Logs to Cloudflare Analytics
//!      - Strips device IP from the upstream request
//!    Benefit: the API key never lives on the device. Even if AVA007
//!    is compromised, the attacker only gets a device-scoped token.
//!
//! 2. **Webhook ingress** (inbound): Telnyx fires webhooks at
//!    `https://<worker>.workers.dev/webhook` when inbound WhatsApp
//!    messages arrive. The Worker:
//!      - Validates the Telnyx signature header
//!      - Forwards the event to AVA007 via Cloudflare Tunnel
//!      - Returns 200 OK to Telnyx immediately (no blocking)
//!
//! 3. **Cloudflare Tunnel** (device ingress): AVA007 runs `cloudflared`
//!    as a subprocess. The tunnel exposes a local HTTP server
//!    (port 8787) at `https://<tunnel-id>.cfargotunnel.com`. The Worker
//!    forwards webhook events to this URL.
//!
//! Result: AVA007 receives inbound WhatsApp messages without opening
//! any inbound firewall ports on the device.

use std::sync::Arc;
use std::time::Duration;

use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;

pub mod worker;
pub mod tunnel;
pub mod webhook;

pub use worker::WorkerClient;
pub use tunnel::TunnelHandle;
pub use webhook::{WebhookServer, WebhookEvent};

/// Cloudflare mesh configuration.
#[derive(Clone, Debug)]
pub struct CloudflareConfig {
    /// Worker URL for egress (e.g. https://ava007-proxy.example.workers.dev)
    pub worker_url: Arc<str>,

    /// Tunnel ingress URL (where the Worker forwards webhooks to).
    /// Set by TunnelHandle::start() — leave None at config time.
    pub tunnel_ingress_url: Option<Arc<str>>,

    /// Webhook signing secret (shared between Worker and AVA007).
    /// Used to verify webhook signatures on both sides.
    pub webhook_secret: Arc<str>,

    /// Local webhook server port (default 8787).
    pub local_port: u16,

    /// HTTP timeout for Worker calls.
    pub timeout: Duration,

    /// Maximum events to queue from webhook → AVA007.
    pub webhook_queue_capacity: usize,
}

impl Default for CloudflareConfig {
    fn default() -> Self {
        Self {
            // Default Worker URL pattern — replace <your-subdomain> with
            // your actual Worker name from `wrangler deploy` output.
            // Or override via the AVA007_WORKER_URL env var at startup.
            worker_url: std::env::var("AVA007_WORKER_URL")
                .unwrap_or_else(|_| "https://ava007-telnyx-proxy.example.workers.dev".into())
                .into(),
            tunnel_ingress_url: None,
            webhook_secret: std::env::var("AVA007_WEBHOOK_SECRET")
                .unwrap_or_else(|_| "change-me-in-production".into())
                .into(),
            local_port: 8787,
            timeout: Duration::from_secs(15),
            webhook_queue_capacity: 64,
        }
    }
}

/// Top-level Cloudflare mesh handle. Owns the Worker client, webhook
/// server, and tunnel subprocess.
pub struct CloudflareMesh {
    config: Arc<CloudflareConfig>,
    worker: Arc<WorkerClient>,
    webhook_rx: RwLock<Option<mpsc::Receiver<WebhookEvent>>>,
    tunnel: RwLock<Option<Arc<TunnelHandle>>>,
}

impl CloudflareMesh {
    /// Bootstrap the mesh. Does NOT start the tunnel — call start_tunnel() separately.
    pub fn new(config: CloudflareConfig) -> anyhow::Result<Arc<Self>> {
        let config_arc = Arc::new(config);
        let worker = Arc::new(WorkerClient::new(config_arc.clone())?);
        Ok(Arc::new(Self {
            config: config_arc,
            worker,
            webhook_rx: RwLock::new(None),
            tunnel: RwLock::new(None),
        }))
    }

    /// Start the local webhook server + cloudflared tunnel.
    /// Returns a receiver that yields inbound webhook events.
    pub async fn start(&self) -> anyhow::Result<mpsc::Receiver<WebhookEvent>> {
        // 1. Start webhook server on local port
        let (tx, rx) = mpsc::channel(self.config.webhook_queue_capacity);
        let server = WebhookServer::new(
            self.config.local_port,
            self.config.webhook_secret.clone(),
            tx,
        );
        server.spawn();

        // 2. Start cloudflared tunnel pointing at the local server
        let tunnel = TunnelHandle::start(
            self.config.local_port,
        ).await?;
        *self.tunnel.write() = Some(tunnel.clone());

        // 3. Register the tunnel URL with the Worker (so it knows where to forward)
        if let Some(tunnel_url) = tunnel.public_url() {
            self.worker.register_tunnel(&tunnel_url).await?;
        }

        Ok(rx)
    }

    pub fn worker(&self) -> &Arc<WorkerClient> {
        &self.worker
    }

    pub fn config(&self) -> &CloudflareConfig {
        &self.config
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_defaults_are_sane() {
        let cfg = CloudflareConfig::default();
        assert!(cfg.worker_url.starts_with("https://"));
        assert!(cfg.local_port > 0);
        assert!(cfg.timeout.as_secs() > 0);
        assert!(cfg.webhook_queue_capacity > 0);
    }
}
