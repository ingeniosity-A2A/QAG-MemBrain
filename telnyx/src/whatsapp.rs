//! WhatsApp client — messaging + calling APIs.
//!
//! Endpoints (all Knox-safe cloud calls to api.telnyx.com):
//!
//!   POST /v2/whatsapp_messages
//!     → send a WhatsApp message (text, media, or template)
//!
//!   GET  /v2/whatsapp_messages/{id}
//!     → get status of a sent message
//!
//!   POST /v2/whatsapp_phone_numbers/{phone_id}/calling
//!     → enable/disable WhatsApp calling on a Telnyx number
//!
//!   GET  /v2/whatsapp_phone_numbers/{phone_id}
//!     → get WhatsApp number details (calling_enabled, messaging_enabled)
//!
//! Inbound messages arrive via webhook (see webhook.rs in cloudflare_mesh).

use std::sync::Arc;

use serde::Serialize;
use tracing::{info, warn};

use crate::{TelnyxClient, TelnyxError};
use crate::models::*;

pub struct WhatsAppClient {
    client: Arc<TelnyxClient>,
}

impl WhatsAppClient {
    pub fn new(client: Arc<TelnyxClient>) -> Arc<Self> {
        Arc::new(Self { client })
    }

    /// Send a text WhatsApp message.
    ///
    /// POST /v2/whatsapp_messages
    pub async fn send_text(
        &self,
        from: &str,
        to: &str,
        text: &str,
    ) -> anyhow::Result<WhatsAppMessageData> {
        let req = SendWhatsAppMessageRequest {
            from: from.into(),
            to: to.into(),
            text: Some(text.into()),
            media_url: None,
            template: None,
            webhook_url: None,
            client_correlation_id: None,
        };
        self.send_message(req).await
    }

    /// Send a media WhatsApp message.
    pub async fn send_media(
        &self,
        from: &str,
        to: &str,
        media_url: &str,
        caption: Option<&str>,
    ) -> anyhow::Result<WhatsAppMessageData> {
        let req = SendWhatsAppMessageRequest {
            from: from.into(),
            to: to.into(),
            text: caption.map(|c| c.into()),
            media_url: Some(media_url.into()),
            template: None,
            webhook_url: None,
            client_correlation_id: None,
        };
        self.send_message(req).await
    }

    /// Send a template WhatsApp message (pre-approved by WhatsApp Business).
    pub async fn send_template(
        &self,
        from: &str,
        to: &str,
        template_name: &str,
        language: &str,
        variables: Vec<Arc<str>>,
    ) -> anyhow::Result<WhatsAppMessageData> {
        let req = SendWhatsAppMessageRequest {
            from: from.into(),
            to: to.into(),
            text: None,
            media_url: None,
            template: Some(WhatsAppTemplate {
                name: template_name.into(),
                language: language.into(),
                variables: if variables.is_empty() { None } else { Some(variables) },
            }),
            webhook_url: None,
            client_correlation_id: None,
        };
        self.send_message(req).await
    }

    /// Low-level: send any SendWhatsAppMessageRequest.
    pub async fn send_message(
        &self,
        req: SendWhatsAppMessageRequest,
    ) -> anyhow::Result<WhatsAppMessageData> {
        let url = self.client.request_url("/v2/whatsapp_messages");
        let (auth_key, auth_val) = self.client.auth_header()?;

        info!(
            "Telnyx WhatsApp send: from={} to={} text_len={}",
            req.from,
            req.to,
            req.text.as_ref().map(|t| t.len()).unwrap_or(0)
        );

        let resp = self.client.http()
            .post(&url)
            .header(&auth_key, &auth_val)
            .header("Content-Type", "application/json")
            .header("Accept", "application/json")
            .json(&req)
            .send()
            .await?;

        let status = resp.status();
        self.update_rate_limit_from_headers(resp.headers());

        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            if let Ok(err) = serde_json::from_str::<TelnyxError>(&body) {
                anyhow::bail!(
                    "Telnyx API error {}: {} — {}",
                    status,
                    err.errors.first().map(|e| e.title.as_ref()).unwrap_or("unknown"),
                    err.errors.first().map(|e| e.detail.as_ref().map(|d| d.as_ref()).unwrap_or("")).unwrap_or(""),
                );
            }
            anyhow::bail!("Telnyx API error {}: {}", status, body);
        }

        let body: SendWhatsAppMessageResponse = resp.json().await?;
        info!(
            "Telnyx WhatsApp sent: id={} status={}",
            body.data.id, body.data.status
        );

        Ok(body.data)
    }

    /// Get the status of a previously-sent message.
    /// GET /v2/whatsapp_messages/{id}
    pub async fn get_message_status(
        &self,
        message_id: &str,
    ) -> anyhow::Result<WhatsAppMessageData> {
        let url = self.client.request_url(&format!("/v2/whatsapp_messages/{}", message_id));
        let (auth_key, auth_val) = self.client.auth_header()?;

        let resp = self.client.http()
            .get(&url)
            .header(&auth_key, &auth_val)
            .header("Accept", "application/json")
            .send()
            .await?;

        let status = resp.status();
        self.update_rate_limit_from_headers(resp.headers());

        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("Telnyx API error {}: {}", status, body);
        }

        let body: SendWhatsAppMessageResponse = resp.json().await?;
        Ok(body.data)
    }

    /// Enable or disable WhatsApp calling on a Telnyx-owned number.
    ///
    /// POST /v2/whatsapp_phone_numbers/{phone_id}/calling
    ///
    /// This is the endpoint the user explicitly asked for. Knox-safe:
    /// we're configuring a cloud-side WhatsApp Business number — we
    /// never touch the device's own telephony stack.
    pub async fn set_calling_enabled(
        &self,
        phone_id: &str,
        enabled: bool,
    ) -> anyhow::Result<WhatsAppCallingData> {
        let url = self.client.request_url(&format!(
            "/v2/whatsapp_phone_numbers/{}/calling",
            phone_id
        ));
        let (auth_key, auth_val) = self.client.auth_header()?;

        let req = SetWhatsAppCallingRequest { calling_enabled: enabled };

        info!(
            "Telnyx WhatsApp calling set: phone_id={} enabled={}",
            phone_id, enabled
        );

        let resp = self.client.http()
            .post(&url)
            .header(&auth_key, &auth_val)
            .header("Content-Type", "application/json")
            .header("Accept", "application/json")
            .json(&req)
            .send()
            .await?;

        let status = resp.status();
        self.update_rate_limit_from_headers(resp.headers());

        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            if let Ok(err) = serde_json::from_str::<TelnyxError>(&body) {
                anyhow::bail!(
                    "Telnyx API error {}: {}",
                    status,
                    err.errors.first().map(|e| e.title.as_ref()).unwrap_or("unknown"),
                );
            }
            anyhow::bail!("Telnyx API error {}: {}", status, body);
        }

        let body: SetWhatsAppCallingResponse = resp.json().await?;
        info!(
            "Telnyx WhatsApp calling set OK: phone_id={} calling_enabled={}",
            body.data.id, body.data.calling_enabled
        );

        Ok(body.data)
    }

    /// Get WhatsApp number details (calling_enabled, messaging_enabled).
    /// GET /v2/whatsapp_phone_numbers/{phone_id}
    pub async fn get_number_details(
        &self,
        phone_id: &str,
    ) -> anyhow::Result<WhatsAppNumberData> {
        let url = self.client.request_url(&format!(
            "/v2/whatsapp_phone_numbers/{}",
            phone_id
        ));
        let (auth_key, auth_val) = self.client.auth_header()?;

        let resp = self.client.http()
            .get(&url)
            .header(&auth_key, &auth_val)
            .header("Accept", "application/json")
            .send()
            .await?;

        let status = resp.status();
        self.update_rate_limit_from_headers(resp.headers());

        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("Telnyx API error {}: {}", status, body);
        }

        let body: GetWhatsAppNumberResponse = resp.json().await?;
        Ok(body.data)
    }

    fn update_rate_limit_from_headers(&self, headers: &reqwest::header::HeaderMap) {
        use std::str::FromStr;
        let limit = headers.get("x-ratelimit-limit")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| u32::from_str(s).ok());
        let remaining = headers.get("x-ratelimit-remaining")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| u32::from_str(s).ok());
        let reset = headers.get("x-ratelimit-reset")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| i64::from_str(s).ok());

        if let (Some(l), Some(r)) = (limit, remaining) {
            self.client.update_rate_limit(RateLimitInfo {
                limit: l,
                remaining: r,
                reset_at_unix: reset.unwrap_or(0),
            });
        }
    }
}

// Bring RateLimitInfo into scope for the update call
use crate::RateLimitInfo;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{TelnyxAuth, TelnyxConfig};
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    async fn make_client(server_uri: &str) -> Arc<WhatsAppClient> {
        let config = TelnyxConfig {
            base_url: server_uri.into(),
            ..Default::default()
        };
        std::env::set_var("TELNYX_API_KEY", "test_key");
        let auth = TelnyxAuth::new();
        let telnyx = TelnyxClient::new(config, auth).unwrap();
        telnyx.whatsapp()
    }

    #[tokio::test]
    async fn send_text_posts_to_whatsapp_messages() {
        let server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/v2/whatsapp_messages"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "data": {
                    "id": "msg_001",
                    "from": "+15550000000",
                    "to": "+15551111111",
                    "text": "Hello",
                    "created_at": "2026-06-27T10:00:00Z",
                    "direction": "outbound",
                    "status": "queued",
                    "phone_number_id": "ph_xyz"
                }
            })))
            .mount(&server)
            .await;

        let client = make_client(&server.uri()).await;
        let result = client.send_text("+15550000000", "+15551111111", "Hello").await.unwrap();

        assert_eq!(result.id.as_ref(), "msg_001");
        assert_eq!(result.status.as_ref(), "queued");
    }

    #[tokio::test]
    async fn set_calling_enabled_posts_to_calling_endpoint() {
        let server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/v2/whatsapp_phone_numbers/ph_123/calling"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "data": {
                    "id": "ph_123",
                    "phone_number": "+15550000000",
                    "calling_enabled": true,
                    "updated_at": "2026-06-27T10:00:00Z"
                }
            })))
            .mount(&server)
            .await;

        let client = make_client(&server.uri()).await;
        let result = client.set_calling_enabled("ph_123", true).await.unwrap();

        assert_eq!(result.id.as_ref(), "ph_123");
        assert!(result.calling_enabled);
    }

    #[tokio::test]
    async fn get_number_details_returns_calling_status() {
        let server = MockServer::start().await;

        Mock::given(method("GET"))
            .and(path("/v2/whatsapp_phone_numbers/ph_456"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "data": {
                    "id": "ph_456",
                    "phone_number": "+15552222222",
                    "calling_enabled": false,
                    "messaging_enabled": true,
                    "webhook_url": "https://worker.example.workers.dev/webhook",
                    "created_at": "2026-01-01T00:00:00Z",
                    "updated_at": "2026-06-27T10:00:00Z"
                }
            })))
            .mount(&server)
            .await;

        let client = make_client(&server.uri()).await;
        let details = client.get_number_details("ph_456").await.unwrap();

        assert_eq!(details.id.as_ref(), "ph_456");
        assert!(!details.calling_enabled);
        assert!(details.messaging_enabled);
    }

    #[tokio::test]
    async fn returns_error_on_telnyx_api_failure() {
        let server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/v2/whatsapp_messages"))
            .respond_with(ResponseTemplate::new(422).set_body_json(serde_json::json!({
                "errors": [{
                    "code": "invalid_phone_number",
                    "title": "Invalid phone number",
                    "detail": "To: must be E.164 format"
                }]
            })))
            .mount(&server)
            .await;

        let client = make_client(&server.uri()).await;
        let result = client.send_text("+15550000000", "bad-number", "Hello").await;

        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("Invalid phone number"));
    }

    #[tokio::test]
    async fn send_template_includes_template_field() {
        let server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/v2/whatsapp_messages"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "data": {
                    "id": "msg_tpl_1",
                    "from": "+15550000000",
                    "to": "+15551111111",
                    "text": null,
                    "created_at": "2026-06-27T10:00:00Z",
                    "direction": "outbound",
                    "status": "queued",
                    "phone_number_id": "ph_xyz"
                }
            })))
            .mount(&server)
            .await;

        let client = make_client(&server.uri()).await;
        let result = client.send_template(
            "+15550000000",
            "+15551111111",
            "appointment_reminder",
            "en_US",
            vec!["John".into(), "3pm".into()],
        ).await.unwrap();

        assert_eq!(result.id.as_ref(), "msg_tpl_1");
    }
}
