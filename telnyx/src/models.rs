//! Telnyx API request/response models.

use std::sync::Arc;
use serde::{Deserialize, Serialize};

// ── WhatsApp messaging ─────────────────────────────────────────────────────

/// Send a WhatsApp message. POST /v2/whatsapp_messages
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SendWhatsAppMessageRequest {
    /// Telnyx phone number ID (the sender)
    pub from: Arc<str>,

    /// Recipient phone number in E.164 (e.g. "+15551234567")
    pub to: Arc<str>,

    /// Message body. For text messages this is the text.
    /// For template messages, use `template` field instead.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<Arc<str>>,

    /// Optional media URL (for image/video/document messages)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub media_url: Option<Arc<str>>,

    /// Optional template (for pre-approved WhatsApp Business templates)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub template: Option<WhatsAppTemplate>,

    /// Optional webhook URL override
    #[serde(skip_serializing_if = "Option::is_none")]
    pub webhook_url: Option<Arc<str>>,

    /// Optional client-supplied correlation ID
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_correlation_id: Option<Arc<str>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhatsAppTemplate {
    pub name: Arc<str>,
    pub language: Arc<str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub variables: Option<Vec<Arc<str>>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SendWhatsAppMessageResponse {
    pub data: WhatsAppMessageData,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhatsAppMessageData {
    /// Telnyx-generated message ID
    pub id: Arc<str>,

    /// E.164 sender
    pub from: Arc<str>,

    /// E.164 recipient
    pub to: Arc<str>,

    /// Message text (echoed back)
    pub text: Option<Arc<str>>,

    /// Timestamp (ISO 8601)
    pub created_at: Arc<str>,

    /// Direction: "outbound" or "inbound"
    pub direction: Arc<str>,

    /// Status: "queued", "sent", "delivered", "read", "failed"
    pub status: Arc<str>,

    /// Telnyx phone number ID used
    pub phone_number_id: Arc<str>,
}

// ── WhatsApp calling ───────────────────────────────────────────────────────
// Endpoint: POST /v2/whatsapp_phone_numbers/{phone_id}/calling
// Enables or disables WhatsApp calling on a Telnyx-owned WhatsApp number.
// Knox-safe: this is a cloud-side configuration that does NOT touch
// the device's own telephony stack.

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetWhatsAppCallingRequest {
    /// true = enable WhatsApp calling on this number
    /// false = disable WhatsApp calling on this number
    pub calling_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetWhatsAppCallingResponse {
    pub data: WhatsAppCallingData,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhatsAppCallingData {
    /// Telnyx phone number ID
    pub id: Arc<str>,

    /// WhatsApp Business phone number in E.164
    pub phone_number: Arc<str>,

    /// Whether calling is now enabled
    pub calling_enabled: bool,

    /// Timestamp of last update
    pub updated_at: Arc<str>,
}

// ── Get WhatsApp phone number details ──────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GetWhatsAppNumberResponse {
    pub data: WhatsAppNumberData,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhatsAppNumberData {
    pub id: Arc<str>,
    pub phone_number: Arc<str>,
    pub calling_enabled: bool,
    pub messaging_enabled: bool,
    pub webhook_url: Option<Arc<str>>,
    pub created_at: Arc<str>,
    pub updated_at: Arc<str>,
}

// ── Inbound webhook payload (received by AVA007 webhook server) ────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelnyxWebhookEvent {
    pub data: TelnyxWebhookEventData,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelnyxWebhookEventData {
    pub id: Arc<str>,
    pub record_type: Arc<str>,  // "whatsapp_message"
    pub event_type: Arc<str>,   // "message.received", "message.delivered", etc.
    pub occurred_at: Arc<str>,
    pub payload: WhatsAppMessageData,
}

// ── Errors ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelnyxError {
    pub errors: Vec<TelnyxErrorDetail>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelnyxErrorDetail {
    pub code: Arc<str>,
    pub title: Arc<str>,
    pub detail: Option<Arc<str>>,
    pub source: Option<TelnyxErrorSource>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelnyxErrorSource {
    pub pointer: Option<Arc<str>>,
    pub parameter: Option<Arc<str>>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serialize_send_message_request() {
        let req = SendWhatsAppMessageRequest {
            from: "+15550000000".into(),
            to: "+15551111111".into(),
            text: Some("Hello from AVA007".into()),
            media_url: None,
            template: None,
            webhook_url: None,
            client_correlation_id: Some("ava007-turn-42".into()),
        };
        let json = serde_json::to_value(&req).unwrap();
        assert_eq!(json["from"], "+15550000000");
        assert_eq!(json["text"], "Hello from AVA007");
        assert!(json["media_url"].is_null());
    }

    #[test]
    fn deserialize_message_response() {
        let json = serde_json::json!({
            "data": {
                "id": "msg_abc123",
                "from": "+15550000000",
                "to": "+15551111111",
                "text": "Hello",
                "created_at": "2026-06-27T10:00:00Z",
                "direction": "outbound",
                "status": "queued",
                "phone_number_id": "ph_xyz"
            }
        });
        let resp: SendWhatsAppMessageResponse = serde_json::from_value(json).unwrap();
        assert_eq!(resp.data.id.as_ref(), "msg_abc123");
        assert_eq!(resp.data.status.as_ref(), "queued");
    }

    #[test]
    fn calling_request_serializes_to_boolean() {
        let req = SetWhatsAppCallingRequest { calling_enabled: true };
        let json = serde_json::to_string(&req).unwrap();
        assert_eq!(json, r#"{"calling_enabled":true}"#);
    }

    #[test]
    fn webhook_event_deserializes() {
        let json = serde_json::json!({
            "data": {
                "id": "evt_001",
                "record_type": "whatsapp_message",
                "event_type": "message.received",
                "occurred_at": "2026-06-27T10:05:00Z",
                "payload": {
                    "id": "msg_inbound_1",
                    "from": "+15551111111",
                    "to": "+15550000000",
                    "text": "Hi AVA007",
                    "created_at": "2026-06-27T10:05:00Z",
                    "direction": "inbound",
                    "status": "received",
                    "phone_number_id": "ph_xyz"
                }
            }
        });
        let evt: TelnyxWebhookEvent = serde_json::from_value(json).unwrap();
        assert_eq!(evt.data.event_type.as_ref(), "message.received");
        assert_eq!(evt.data.payload.text.as_ref().unwrap().as_ref(), "Hi AVA007");
    }
}
