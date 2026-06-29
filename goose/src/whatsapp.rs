//! WhatsApp service — bridges GOOSE → Telnyx.
//!
//! When the Meta Harness routes a `WhatsApp` intent to GOOSE, the dispatcher
//! delegates here. This module:
//!
//!   1. Parses the user's natural-language request into a structured action
//!      (send message / enable calling / disable calling / get number details)
//!   2. Calls the corresponding Telnyx API
//!   3. Returns a human-readable result string
//!
//! Knox-safe: every call goes to api.telnyx.com via HTTPS. The device's
//! own telephony stack (modem/SIM/IMEI/EFS) is never touched.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tracing::info;

use meta_harness::router::{GooseRequest, GooseService};
use telnyx::WhatsAppClient;

/// Structured WhatsApp action parsed from the user's query.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum WhatsAppAction {
    /// Send a text message to a recipient
    SendMessage {
        from: Arc<str>,  // E.164 sender (Telnyx WhatsApp number)
        to: Arc<str>,    // E.164 recipient
        text: Arc<str>,  // message body
    },
    /// Enable WhatsApp calling on a Telnyx number
    EnableCalling {
        phone_id: Arc<str>,  // Telnyx phone number ID
    },
    /// Disable WhatsApp calling on a Telnyx number
    DisableCalling {
        phone_id: Arc<str>,
    },
    /// Get the current status of a Telnyx WhatsApp number
    GetNumberStatus {
        phone_id: Arc<str>,
    },
}

pub struct WhatsAppService {
    client: Arc<WhatsAppClient>,
}

impl WhatsAppService {
    pub fn new(client: Arc<WhatsAppClient>) -> Arc<Self> {
        Arc::new(Self { client })
    }

    /// Execute a GooseRequest that was routed to the WhatsApp service.
    ///
    /// Parses the user's natural-language query into a structured action,
    /// then calls the appropriate Telnyx API.
    pub async fn execute(&self, req: &GooseRequest) -> anyhow::Result<Arc<str>> {
        let action = parse_action(&req.query)?;
        self.execute_action(action).await
    }

    pub async fn execute_action(&self, action: WhatsAppAction) -> anyhow::Result<Arc<str>> {
        match action {
            WhatsAppAction::SendMessage { from, to, text } => {
                let result = self.client.send_text(&from, &to, &text).await?;
                Ok(format!(
                    "Message sent to {}. Telnyx ID: {} (status: {})",
                    to, result.id, result.status
                ).into())
            }
            WhatsAppAction::EnableCalling { phone_id } => {
                let result = self.client.set_calling_enabled(&phone_id, true).await?;
                Ok(format!(
                    "WhatsApp calling ENABLED on {} ({})",
                    result.phone_number, result.id
                ).into())
            }
            WhatsAppAction::DisableCalling { phone_id } => {
                let result = self.client.set_calling_enabled(&phone_id, false).await?;
                Ok(format!(
                    "WhatsApp calling DISABLED on {} ({})",
                    result.phone_number, result.id
                ).into())
            }
            WhatsAppAction::GetNumberStatus { phone_id } => {
                let result = self.client.get_number_details(&phone_id).await?;
                Ok(format!(
                    "Number {}: calling={}, messaging={}, webhook={}",
                    result.phone_number,
                    result.calling_enabled,
                    result.messaging_enabled,
                    result.webhook_url.as_ref().map(|u| u.as_ref()).unwrap_or("(none)")
                ).into())
            }
        }
    }
}

/// Parse a natural-language WhatsApp request into a structured action.
///
/// Examples:
///   "send WhatsApp message to +15551111111 saying hello"
///       → SendMessage { from: <default>, to: "+15551111111", text: "hello" }
///   "enable WhatsApp calling on phone ph_abc123"
///       → EnableCalling { phone_id: "ph_abc123" }
///   "disable WhatsApp calling on phone ph_abc123"
///       → DisableCalling { phone_id: "ph_abc123" }
///   "what's the status of my WhatsApp number ph_abc123"
///       → GetNumberStatus { phone_id: "ph_abc123" }
fn parse_action(query: &str) -> anyhow::Result<WhatsAppAction> {
    let q = query.to_lowercase();

    // Try EnableCalling
    if q.contains("enable") && q.contains("calling") {
        let phone_id = extract_phone_id(query)?;
        return Ok(WhatsAppAction::EnableCalling { phone_id });
    }

    // Try DisableCalling
    if q.contains("disable") && q.contains("calling") {
        let phone_id = extract_phone_id(query)?;
        return Ok(WhatsAppAction::DisableCalling { phone_id });
    }

    // Try GetNumberStatus
    if q.contains("status") && (q.contains("number") || q.contains("phone")) {
        let phone_id = extract_phone_id(query)?;
        return Ok(WhatsAppAction::GetNumberStatus { phone_id });
    }

    // Try SendMessage — must have a phone number and "saying"/"message"
    if q.contains("send") && q.contains("whatsapp") {
        let to = extract_phone_number(query)?;
        let text = extract_message_body(query)?;
        let from = extract_sender(query)
            .unwrap_or_else(|_| "+15550000000".into()); // default sender
        return Ok(WhatsAppAction::SendMessage { from, to, text });
    }

    anyhow::bail!(
        "Could not parse WhatsApp action from query: '{}'. \
         Try: 'send WhatsApp message to +15551111111 saying hello', \
         'enable WhatsApp calling on phone ph_abc123', \
         'disable WhatsApp calling on phone ph_abc123', \
         'status of my WhatsApp number ph_abc123'",
        query
    )
}

/// Extract a phone ID (ph_xxx pattern) from a query.
fn extract_phone_id(query: &str) -> anyhow::Result<Arc<str>> {
    let re = regex::Regex::new(r"ph_[a-zA-Z0-9]+").unwrap();
    if let Some(m) = re.find(query) {
        return Ok(m.as_str().into());
    }
    anyhow::bail!("No phone_id found (expected ph_xxx pattern)")
}

/// Extract an E.164 phone number (+ followed by digits).
fn extract_phone_number(query: &str) -> anyhow::Result<Arc<str>> {
    let re = regex::Regex::new(r"\+\d{6,15}").unwrap();
    if let Some(m) = re.find(query) {
        return Ok(m.as_str().into());
    }
    anyhow::bail!("No phone number found (expected E.164 format like +15551111111)")
}

/// Extract the message body — text after "saying" or after a quoted string.
fn extract_message_body(query: &str) -> anyhow::Result<Arc<str>> {
    let lower = query.to_lowercase();

    // Look for "saying X" or "with message X"
    for marker in &["saying ", "with message ", "message: ", "saying \""] {
        if let Some(idx) = lower.find(marker) {
            let start = idx + marker.len();
            let rest = &query[start..];
            // Strip trailing quotes if present
            let trimmed = rest.trim_matches('"').trim();
            if !trimmed.is_empty() {
                return Ok(trimmed.into());
            }
        }
    }

    // Try quoted text: send WhatsApp message to +1555... "hello there"
    let re = regex::Regex::new(r#""([^"]+)""#).unwrap();
    if let Some(caps) = re.captures(query) {
        if let Some(m) = caps.get(1) {
            return Ok(m.as_str().into());
        }
    }

    anyhow::bail!("No message body found. Try 'saying <text>' or '\"<text>\"'")
}

/// Extract the sender number — text after "from +XXXX".
fn extract_sender(query: &str) -> anyhow::Result<Arc<str>> {
    let lower = query.to_lowercase();
    if let Some(idx) = lower.find("from ") {
        let rest = &query[idx + 5..];
        let re = regex::Regex::new(r"\+\d{6,15}").unwrap();
        if let Some(m) = re.find(rest) {
            return Ok(m.as_str().into());
        }
    }
    anyhow::bail!("No sender specified")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_send_message_with_saying() {
        let action = parse_action(
            "send WhatsApp message to +15551111111 saying hello world"
        ).unwrap();
        match action {
            WhatsAppAction::SendMessage { from, to, text } => {
                assert_eq!(to.as_ref(), "+15551111111");
                assert_eq!(text.as_ref(), "hello world");
                assert_eq!(from.as_ref(), "+15550000000"); // default
            }
            _ => panic!("expected SendMessage"),
        }
    }

    #[test]
    fn parses_send_message_with_quoted_text() {
        let action = parse_action(
            "send WhatsApp to +15551111111 \"hello there\""
        ).unwrap();
        match action {
            WhatsAppAction::SendMessage { to, text, .. } => {
                assert_eq!(to.as_ref(), "+15551111111");
                assert_eq!(text.as_ref(), "hello there");
            }
            _ => panic!("expected SendMessage"),
        }
    }

    #[test]
    fn parses_enable_calling() {
        let action = parse_action(
            "enable WhatsApp calling on phone ph_abc123"
        ).unwrap();
        match action {
            WhatsAppAction::EnableCalling { phone_id } => {
                assert_eq!(phone_id.as_ref(), "ph_abc123");
            }
            _ => panic!("expected EnableCalling"),
        }
    }

    #[test]
    fn parses_disable_calling() {
        let action = parse_action(
            "disable WhatsApp calling on phone ph_xyz789"
        ).unwrap();
        match action {
            WhatsAppAction::DisableCalling { phone_id } => {
                assert_eq!(phone_id.as_ref(), "ph_xyz789");
            }
            _ => panic!("expected DisableCalling"),
        }
    }

    #[test]
    fn parses_get_number_status() {
        let action = parse_action(
            "what's the status of my WhatsApp number ph_test001"
        ).unwrap();
        match action {
            WhatsAppAction::GetNumberStatus { phone_id } => {
                assert_eq!(phone_id.as_ref(), "ph_test001");
            }
            _ => panic!("expected GetNumberStatus"),
        }
    }

    #[test]
    fn errors_on_unparseable_query() {
        let result = parse_action("hello there");
        assert!(result.is_err());
    }

    #[test]
    fn extracts_e164_phone_number() {
        let n = extract_phone_number("call +15551234567 now").unwrap();
        assert_eq!(n.as_ref(), "+15551234567");
    }

    #[test]
    fn extracts_phone_id() {
        let id = extract_phone_id("enable calling on ph_abcXYZ123").unwrap();
        assert_eq!(id.as_ref(), "ph_abcXYZ123");
    }
}
