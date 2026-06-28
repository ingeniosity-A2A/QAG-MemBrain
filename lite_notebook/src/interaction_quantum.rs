//! Interaction Quantum — the fundamental computational primitive.
//!
//! Ported from `Latent-skill/interaction_quantum.ts` (white paper §4).
//!
//! An Interaction Quantum IS a Receipt — it extends the base JSONL schema
//! with signal-processing metadata fields. Existing pipeline code
//! (Receipt → Tashi → GSAP → Neo4j → Brain) handles it unchanged.
//!
//! Signal metadata fields are first-class citizens:
//!   - rf_physical     — CC1101 / SX1262 transceiver configuration
//!   - crypto_routing  — ChaCha20-Poly1305, X25519, AODV mesh
//!   - temporal_index  — GSAP ticker, Doppler, RSSI, angle-of-arrival
//!   - temporal_tween  — tween type passed to GSAP Replay Engine
//!
//! Conversions:
//!   RSSI → confidence score (existing Receipt field)
//!   Doppler shift → GSAP timeScale modulation
//!   Spreading factor → cognitive weight

use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::receipt::{Origin, Receipt, ReceiptKind};

/// RF physical layer configuration (CC1101 / SX1262 / BLE5 / WiFiAware / UWB).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RFPhysical {
    pub transceiver: Transceiver,
    pub modulation: Modulation,
    pub frequency_hz: u64,
    pub bandwidth_hz: u32,
    pub spreading_factor: u8,
    pub coding_rate: CodingRate,
    pub tx_power_dbm: i16,
    pub rx_sensitivity_dbm: i16,
    pub regional_plan: RegionalPlan,
    pub data_rate_bps: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Transceiver {
    CC1101,
    SX1262,
    BLE5,
    WiFiAware,
    UWB,
    Simulated,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Modulation {
    CSS,
    FSK,
    LoRa,
    BLE,
    NAN,
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CodingRate {
    FourFive,
    FourSix,
    FourSeven,
    FourEight,
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RegionalPlan {
    US915,
    EU868,
    AU915,
    AS923,
    None,
}

/// Cryptographic + mesh routing configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CryptoRouting {
    pub aead: AEAD,
    pub key_exchange: KeyExchange,
    pub fec: FEC,
    pub mesh_protocol: MeshProtocol,
    pub ttl: u8,
    pub path_repair: bool,
    pub destination_did: String,
    pub hop_count: u8,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AEAD {
    ChaCha20Poly1305,
    AES256GCM,
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum KeyExchange {
    X25519ECDH,
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FEC {
    ReedSolomonEightOf16,
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MeshProtocol {
    AODV,
    BATMAN,
    Direct,
    None,
}

/// Temporal + spatial index for GSAP timeline integration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemporalIndex {
    /// Absolute GSAP timeline position (ms)
    pub gsap_ticker_ms: u64,
    /// Drives GSAP timeScale modulation
    pub doppler_shift_hz: f32,
    /// Signal strength → memory weighting
    pub rssi_dbm: i16,
    /// Signal-to-noise → confidence
    pub snr_db: f32,
    /// Spatial memory palace coordinate
    pub angle_of_arrival_deg: f32,
}

/// Tween specification for GSAP Replay Engine.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemporalTween {
    pub tween_type: TweenType,
    pub duration_ms: u32,
    pub from_value: f32,
    pub to_value: f32,
    /// Which cognitive property to tween
    pub property: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TweenType {
    Linear,
    Ease,
    Spring,
    Elastic,
    Power3Out,
}

/// The full Interaction Quantum — a Receipt with optional signal metadata.
///
/// Stored as a Receipt in the Context Ocean; the signal fields are
/// serialized into the Receipt's `metadata` HashMap.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InteractionQuantum {
    /// The base Receipt (L1 Atomic Memory)
    pub receipt: Receipt,
    /// Signal metadata (None for non-RF quanta — fully optional)
    pub rf_physical: Option<RFPhysical>,
    pub crypto_routing: Option<CryptoRouting>,
    pub temporal_index: Option<TemporalIndex>,
    pub temporal_tween: Option<TemporalTween>,
    /// LatentSkill: which weight-space adapter was active at detection time
    pub skill_adapter_id: Option<String>,
    /// Vfile wrapping (A2A rich card embedding)
    pub vfile_version: Option<String>,
    pub beep_channel: Option<String>,
    pub delegation_chain: Option<Vec<String>>,
}

impl InteractionQuantum {
    /// Wrap a Receipt as a minimal InteractionQuantum (no signal metadata).
    pub fn from_receipt(receipt: Receipt) -> Self {
        Self {
            receipt,
            rf_physical: None,
            crypto_routing: None,
            temporal_index: None,
            temporal_tween: None,
            skill_adapter_id: None,
            vfile_version: None,
            beep_channel: None,
            delegation_chain: None,
        }
    }

    /// Build an RF Interaction Quantum from a raw RF event.
    pub fn from_rf_event(opts: RFQuantumOptions) -> Self {
        let rssi = opts.rf.rx_sensitivity_dbm + 30;
        let snr = 8.5_f32;
        let confidence = rssi_to_confidence(rssi);
        let importance = snr_to_importance(snr);

        let temporal_index = TemporalIndex {
            gsap_ticker_ms: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0),
            doppler_shift_hz: 0.0,
            rssi_dbm: rssi,
            snr_db: snr,
            angle_of_arrival_deg: 0.0,
        };

        let receipt = Receipt::new(
            format!("rf-{}", opts.destination_did).into(),
            Origin::User,
            ReceiptKind::Perception,
            opts.content,
            None,
        )
        .with_trust(confidence);

        let crypto = CryptoRouting {
            aead: AEAD::ChaCha20Poly1305,
            key_exchange: KeyExchange::X25519ECDH,
            fec: FEC::ReedSolomonEightOf16,
            mesh_protocol: MeshProtocol::AODV,
            ttl: 15,
            path_repair: true,
            destination_did: opts.destination_did.clone(),
            hop_count: 0,
        };

        let tween = TemporalTween {
            tween_type: TweenType::Linear,
            duration_ms: 100,
            from_value: 0.0,
            to_value: confidence,
            property: "activation".into(),
        };

        Self {
            receipt,
            rf_physical: Some(opts.rf),
            crypto_routing: Some(crypto),
            temporal_index: Some(temporal_index),
            temporal_tween: Some(tween),
            skill_adapter_id: opts.skill_adapter_id,
            vfile_version: None,
            beep_channel: None,
            delegation_chain: None,
        }
    }

    /// Wrap as a Vfile for A2A transmission as a Beeper rich card.
    pub fn wrap_as_vfile(mut self, beep_channel: &str) -> Self {
        self.vfile_version = Some("2.0".into());
        self.beep_channel = Some(beep_channel.into());
        self.delegation_chain = Some(vec![self.receipt.session_id.to_string()]);
        self
    }
}

/// Options for building an RF Interaction Quantum.
pub struct RFQuantumOptions {
    pub source_did: String,
    pub destination_did: String,
    pub rf: RFPhysical,
    pub content: Arc<str>,
    pub skill_adapter_id: Option<String>,
}

/// RSSI → confidence conversion.
///
/// RSSI of -45 dBm (strong) → confidence ~0.98
/// RSSI of -116 dBm (sensitivity floor) → confidence ~0.0
pub fn rssi_to_confidence(rssi_dbm: i16) -> f32 {
    const FLOOR: i16 = -116; // SX1262 sensitivity floor
    const CEIL: i16 = -30;   // typical strong signal
    let clamped = rssi_dbm.max(FLOOR).min(CEIL);
    (clamped as f32 - FLOOR as f32) / (CEIL as f32 - FLOOR as f32)
}

/// SNR → importance tier.
///
/// Returns a string matching the white paper's importance levels:
/// "high" (≥10 dB), "medium" (≥5 dB), "low" (<5 dB)
pub fn snr_to_importance(snr_db: f32) -> &'static str {
    if snr_db >= 10.0 {
        "high"
    } else if snr_db >= 5.0 {
        "medium"
    } else {
        "low"
    }
}

/// Doppler shift → GSAP timeScale.
///
/// Positive Doppler (approaching) → faster cognitive processing
/// Negative Doppler (receding)    → slower, more deliberate processing
/// Range: [0.5, 2.5] matching the 6D engine's relativisticSpeed range
pub fn doppler_to_time_scale(doppler_hz: f32) -> f32 {
    let normalized = doppler_hz / 100.0; // normalize to [-1, +1] range
    (1.5 + normalized).max(0.5).min(2.5)
}

/// Spreading factor → cognitive weight.
///
/// SF7 (fast, short range) → high weight (reflex tier)
/// SF12 (slow, long range) → lower weight (needs cortex)
pub fn sf_to_cognitive_weight(spreading_factor: u8) -> f32 {
    ((13 - spreading_factor as i16) as f32 / 6.0).max(0.1).min(1.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rssi_conversion_boundaries() {
        assert!((rssi_to_confidence(-116) - 0.0).abs() < 0.01);
        assert!((rssi_to_confidence(-30) - 1.0).abs() < 0.01);
        assert!(rssi_to_confidence(-45) > 0.8); // strong signal
        assert!(rssi_to_confidence(-100) < 0.2); // weak signal
    }

    #[test]
    fn snr_to_importance_tiers() {
        assert_eq!(snr_to_importance(15.0), "high");
        assert_eq!(snr_to_importance(10.0), "high");
        assert_eq!(snr_to_importance(7.0), "medium");
        assert_eq!(snr_to_importance(5.0), "medium");
        assert_eq!(snr_to_importance(2.0), "low");
        assert_eq!(snr_to_importance(-5.0), "low");
    }

    #[test]
    fn doppler_time_scale_range() {
        // No Doppler → neutral timeScale (1.5)
        assert!((doppler_to_time_scale(0.0) - 1.5).abs() < 0.01);
        // Approaching → faster
        assert!(doppler_to_time_scale(100.0) > 1.5);
        // Receding → slower
        assert!(doppler_to_time_scale(-100.0) < 1.5);
        // Clamped to [0.5, 2.5]
        assert!(doppler_to_time_scale(1000.0) <= 2.5);
        assert!(doppler_to_time_scale(-1000.0) >= 0.5);
    }

    #[test]
    fn spreading_factor_weights() {
        // SF7 → high weight (fast, short range)
        assert!(sf_to_cognitive_weight(7) > 0.9);
        // SF12 → low weight (slow, long range)
        assert!(sf_to_cognitive_weight(12) < 0.2);
    }

    #[test]
    fn from_receipt_preserves_base() {
        let receipt = Receipt::new(
            "s1".into(),
            Origin::User,
            ReceiptKind::Perception,
            "test".into(),
            None,
        );
        let quantum = InteractionQuantum::from_receipt(receipt);
        assert!(quantum.rf_physical.is_none());
        assert!(quantum.crypto_routing.is_none());
        assert!(quantum.temporal_index.is_none());
    }

    #[test]
    fn wrap_as_vfile_sets_fields() {
        let receipt = Receipt::new(
            "s1".into(),
            Origin::User,
            ReceiptKind::Perception,
            "test".into(),
            None,
        );
        let quantum = InteractionQuantum::from_receipt(receipt)
            .wrap_as_vfile("beeper-channel-1");
        assert_eq!(quantum.vfile_version.as_deref(), Some("2.0"));
        assert_eq!(quantum.beep_channel.as_deref(), Some("beeper-channel-1"));
        assert!(quantum.delegation_chain.is_some());
    }
}
