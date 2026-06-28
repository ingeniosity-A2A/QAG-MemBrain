//! 5-Tier Proximity Mesh — physical-layer device discovery.
//!
//! Ported from `The_integration_point/protocols.ts` (white paper §6).
//!
//! Each tier writes an AtomicMemory to the JSONL ledger. Tashi gossips
//! the vertex to the mesh. Pipeline processes the atom through L1→L6.
//!
//! # Tiers
//!
//!   Tier 1: UWB / NameDrop — AI vCard exchange
//!   Tier 2: NFC — invisible sticker re-engagement
//!   Tier 3: Wi-Fi Aware NAN — cross-platform, no router needed
//!   Tier 4: Blecon BLE-to-cloud — IoT sensor roaming
//!   Tier 5: A2A-BEEP — semantic agent-to-agent POST

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tracing::info;

/// AI-optimized vCard (RFC 6350 extension) for Tier 1 UWB exchange.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AIVCard {
    pub display_name: String,
    pub did: String,
    pub a2a_endpoint: String,
    pub agent_prompt: String,
    pub service_types: Vec<String>,
    pub preferred_rcs: String,
}

impl AIVCard {
    /// Build a vCard string (RFC 6350 format with AGENT extension).
    pub fn to_vcard(&self) -> String {
        format!(
            "BEGIN:VCARD\n\
             VERSION:4.0\n\
             FN:{}\n\
             UID:{}\n\
             AGENT:{}\n\
             URL:{}\n\
             CATEGORIES:{}\n\
             TEL:{}\n\
             END:VCARD",
            self.display_name,
            self.did,
            self.agent_prompt,
            self.a2a_endpoint,
            self.service_types.join(","),
            self.preferred_rcs,
        )
    }
}

/// Which proximity tier detected the interaction.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ProximityTier {
    /// UWB / NameDrop — AI vCard exchange (close range, ~10cm)
    UWB,
    /// NFC — invisible sticker re-engagement (touch, ~4cm)
    NFC,
    /// Wi-Fi Aware NAN — cross-platform, no router needed (~200m)
    WiFiAwareNAN,
    /// Blecon BLE-to-cloud — IoT sensor roaming (~100m)
    Blecon,
    /// A2A-BEEP — semantic agent-to-agent POST (internet)
    A2ABeep,
}

impl ProximityTier {
    pub fn as_str(self) -> &'static str {
        match self {
            ProximityTier::UWB           => "uwb",
            ProximityTier::NFC            => "nfc",
            ProximityTier::WiFiAwareNAN   => "wifi-aware-nan",
            ProximityTier::Blecon         => "blecon",
            ProximityTier::A2ABeep        => "a2a-beep",
        )
    }

    pub fn range_meters(self) -> u32 {
        match self {
            ProximityTier::UWB           => 1,
            ProximityTier::NFC            => 1,
            ProximityTier::WiFiAwareNAN   => 200,
            ProximityTier::Blecon         => 100,
            ProximityTier::A2ABeep        => 0, // internet — no range limit
        }
    }
}

/// A proximity detection event — becomes an InteractionQuantum in the pipeline.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProximityEvent {
    pub tier: ProximityTier,
    pub source_did: String,
    pub destination_did: String,
    pub vcard: Option<AIVCard>,
    pub rssi_dbm: Option<i16>,
    pub content: String,
}

impl ProximityEvent {
    /// Build an event from a UWB/NameDrop vCard exchange.
    pub fn uwb(source: &str, dest: &str, vcard: AIVCard) -> Self {
        Self {
            tier: ProximityTier::UWB,
            source_did: source.into(),
            destination_did: dest.into(),
            vcard: Some(vcard),
            rssi_dbm: Some(-40), // UWB is very close
            content: "UWB vCard exchange".into(),
        }
    }

    /// Build an event from an NFC tap.
    pub fn nfc(source: &str, dest: &str, tag_content: &str) -> Self {
        Self {
            tier: ProximityTier::NFC,
            source_did: source.into(),
            destination_did: dest.into(),
            vcard: None,
            rssi_dbm: Some(-30),
            content: tag_content.into(),
        }
    }

    /// Build an event from a Wi-Fi Aware NAN discovery.
    pub fn nan(source: &str, dest: &str, service_name: &str) -> Self {
        Self {
            tier: ProximityTier::WiFiAwareNAN,
            source_did: source.into(),
            destination_did: dest.into(),
            vcard: None,
            rssi_dbm: Some(-70),
            content: format!("NAN discovery: {}", service_name),
        }
    }

    /// Build an event from a Blecon BLE-to-cloud relay.
    pub fn blecon(source: &str, dest: &str, sensor_data: &str) -> Self {
        Self {
            tier: ProximityTier::Blecon,
            source_did: source.into(),
            destination_did: dest.into(),
            vcard: None,
            rssi_dbm: Some(-80),
            content: format!("Blecon sensor: {}", sensor_data),
        }
    }

    /// Build an event from an A2A-BEEP semantic POST.
    pub fn a2a_beep(source: &str, dest: &str, semantic_payload: &str) -> Self {
        Self {
            tier: ProximityTier::A2ABeep,
            source_did: source.into(),
            destination_did: dest.into(),
            vcard: None,
            rssi_dbm: None, // internet — no RSSI
            content: semantic_payload.into(),
        }
    }
}

/// The proximity mesh manager — discovers devices across all 5 tiers.
pub struct ProximityMesh {
    /// Known nearby devices (DID → last seen tier)
    nearby: parking_lot::RwLock<std::collections::HashMap<String, ProximityTier>>,
}

impl ProximityMesh {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            nearby: parking_lot::RwLock::new(std::collections::HashMap::new()),
        })
    }

    /// Record a proximity detection event.
    pub fn detect(&self, event: ProximityEvent) {
        info!(
            "Proximity detected: tier={} source={} dest={} range={}m",
            event.tier.as_str(),
            event.source_did,
            event.destination_did,
            event.tier.range_meters(),
        );
        self.nearby.write().insert(event.destination_did.clone(), event.tier);
    }

    /// Get all known nearby devices.
    pub fn nearby_devices(&self) -> Vec<(String, ProximityTier)> {
        self.nearby.read().iter()
            .map(|(k, v)| (k.clone(), *v))
            .collect()
    }

    /// Check if a device is nearby on any tier.
    pub fn is_nearby(&self, did: &str) -> bool {
        self.nearby.read().contains_key(did)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vcard_builds_correctly() {
        let card = AIVCard {
            display_name: "AVA007".into(),
            did: "did:ava:node-1".into(),
            a2a_endpoint: "https://ava007.example.com/a2a".into(),
            agent_prompt: "POST service requests to my endpoint".into(),
            service_types: vec!["logistics".into(), "repair".into()],
            preferred_rcs: "+14044391350".into(),
        };
        let vcf = card.to_vcard();
        assert!(vcf.contains("BEGIN:VCARD"));
        assert!(vcf.contains("did:ava:node-1"));
        assert!(vcf.contains("AVA007"));
    }

    #[test]
    fn uwb_event_has_strong_rssi() {
        let card = AIVCard {
            display_name: "test".into(),
            did: "did:ava:node-2".into(),
            a2a_endpoint: "".into(),
            agent_prompt: "".into(),
            service_types: vec![],
            preferred_rcs: "".into(),
        };
        let event = ProximityEvent::uwb("did:ava:node-1", "did:ava:node-2", card);
        assert_eq!(event.tier, ProximityTier::UWB);
        assert!(event.rssi_dbm.unwrap() > -50);
    }

    #[tokio::test]
    async fn mesh_tracks_nearby_devices() {
        let mesh = ProximityMesh::new();
        let event = ProximityEvent::nfc("did:ava:node-1", "did:ava:node-2", "tap!");
        mesh.detect(event);
        assert!(mesh.is_nearby("did:ava:node-2"));
        assert!(!mesh.is_nearby("did:ava:node-999"));
    }
}
