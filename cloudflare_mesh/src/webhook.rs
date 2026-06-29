//! Webhook server — receives inbound Telnyx events from the Cloudflare Worker.
//!
//! Listens on a local port (default 8787). The Worker forwards POST
//! requests here when Telnyx fires webhooks (inbound messages, delivery
//! receipts, etc).
//!
//! Validates the shared webhook secret on every request, then pushes
//! the event onto a tokio mpsc channel for AVA007 to consume.

use std::net::SocketAddr;
use std::sync::Arc;

use axum::{extract::State, http::{HeaderMap, StatusCode}, routing::post, Router};
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;
use tracing::{info, warn};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebhookEvent {
    pub event_type: Arc<str>,   // "message.received", "message.delivered", etc.
    pub from: Option<Arc<str>>, // E.164 sender (for inbound messages)
    pub to: Option<Arc<str>>,   // E.164 recipient
    pub text: Option<Arc<str>>, // message body
    pub message_id: Arc<str>,   // Telnyx message ID
    pub occurred_at: Arc<str>,  // ISO 8601
    pub raw_payload: Arc<str>,  // full JSON for audit
}

pub struct WebhookServer {
    port: u16,
    webhook_secret: Arc<str>,
    event_tx: mpsc::Sender<WebhookEvent>,
}

impl WebhookServer {
    pub fn new(
        port: u16,
        webhook_secret: Arc<str>,
        event_tx: mpsc::Sender<WebhookEvent>,
    ) -> Self {
        Self { port, webhook_secret, event_tx }
    }

    /// Spawn the HTTP server. Returns immediately — runs in background.
    pub fn spawn(self) {
        let addr = SocketAddr::from(([127, 0, 0, 1], self.port));
        let state = Arc::new(WebhookState {
            secret: self.webhook_secret,
            event_tx: self.event_tx,
        });

        let app = Router::new()
            .route("/webhook", post(handle_webhook))
            .route("/health", axum::routing::get(handle_health))
            .with_state(state);

        info!("Webhook server starting on {}", addr);

        tokio::spawn(async move {
            let listener = tokio::net::TcpListener::bind(addr).await;
            match listener {
                Ok(l) => {
                    if let Err(e) = axum::serve(l, app).await {
                        warn!("Webhook server error: {e}");
                    }
                }
                Err(e) => {
                    warn!("Webhook server bind failed on {}: {e}", addr);
                }
            }
        });
    }
}

#[derive(Clone)]
struct WebhookState {
    secret: Arc<str>,
    event_tx: mpsc::Sender<WebhookEvent>,
}

async fn handle_health() -> StatusCode {
    StatusCode::OK
}

async fn handle_webhook(
    State(state): State<Arc<WebhookState>>,
    headers: HeaderMap,
    body: String,
) -> StatusCode {
    // Validate the shared secret
    let provided = headers.get("X-Webhook-Secret")
        .and_then(|v| v.to_str().ok());

    if provided != Some(state.secret.as_ref()) {
        warn!("Webhook rejected: bad or missing X-Webhook-Secret");
        return StatusCode::UNAUTHORIZED;
    }

    // Parse the Telnyx webhook payload
    let payload: serde_json::Value = match serde_json::from_str(&body) {
        Ok(v) => v,
        Err(e) => {
            warn!("Webhook bad JSON: {e}");
            return StatusCode::BAD_REQUEST;
        }
    };

    // Extract the standard fields
    let data = &payload["data"];
    let event_type = data["event_type"].as_str().unwrap_or("unknown").to_string();
    let occurred_at = data["occurred_at"].as_str().unwrap_or("").to_string();
    let message_id = data["payload"]["id"].as_str().unwrap_or("").to_string();
    let from = data["payload"]["from"].as_str().map(|s| s.to_string());
    let to = data["payload"]["to"].as_str().map(|s| s.to_string());
    let text = data["payload"]["text"].as_str().map(|s| s.to_string());

    let event = WebhookEvent {
        event_type: event_type.into(),
        from: from.map(|s| s.into()),
        to: to.map(|s| s.into()),
        text: text.map(|s| s.into()),
        message_id: message_id.into(),
        occurred_at: occurred_at.into(),
        raw_payload: body.into(),
    };

    info!(
        "Webhook event: type={} from={:?} to={:?} msg_id={}",
        event.event_type, event.from, event.to, event.message_id
    );

    // Push to channel (non-blocking — if AVA007 is slow, we drop)
    if let Err(_) = state.event_tx.try_send(event) {
        warn!("Webhook event dropped — AVA007 consumer is slow or channel full");
        return StatusCode::INTERNAL_SERVER_ERROR;
    }

    StatusCode::OK
}

#[cfg(test)]
mod tests {
    use super::*;
    use reqwest::Client;

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn webhook_rejects_missing_secret() {
        let (tx, mut rx) = mpsc::channel(8);
        let server = WebhookServer::new(0, "secret123".into(), tx);
        // Use port 0 — bind will pick an ephemeral port
        // (we'll just spawn and probe)

        // For the test, manually construct the router
        let state = Arc::new(WebhookState {
            secret: "secret123".into(),
            event_tx,
        });
        let app = Router::new()
            .route("/webhook", post(handle_webhook))
            .with_state(state);

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        // POST without secret header
        let resp = Client::new()
            .post(&format!("http://{}/webhook", addr))
            .body(r#"{"data":{"event_type":"test"}}"#)
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);

        // No event should have been pushed
        assert!(rx.try_recv().is_err());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn webhook_accepts_valid_secret_and_pushes_event() {
        let (tx, mut rx) = mpsc::channel(8);
        let state = Arc::new(WebhookState {
            secret: "secret123".into(),
            event_tx: tx,
        });
        let app = Router::new()
            .route("/webhook", post(handle_webhook))
            .with_state(state);

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        let body = serde_json::json!({
            "data": {
                "id": "evt_1",
                "record_type": "whatsapp_message",
                "event_type": "message.received",
                "occurred_at": "2026-06-27T10:00:00Z",
                "payload": {
                    "id": "msg_inbound_1",
                    "from": "+15551111111",
                    "to": "+15550000000",
                    "text": "Hello AVA007",
                    "created_at": "2026-06-27T10:00:00Z",
                    "direction": "inbound",
                    "status": "received"
                }
            }
        });

        let resp = Client::new()
            .post(&format!("http://{}/webhook", addr))
            .header("X-Webhook-Secret", "secret123")
            .json(&body)
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);

        let event = rx.recv().await.unwrap();
        assert_eq!(event.event_type, "message.received");
        assert_eq!(event.from.as_ref().unwrap(), "+15551111111");
        assert_eq!(event.text.as_ref().unwrap(), "Hello AVA007");
    }
}
