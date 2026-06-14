// ═══════════════════════════════════════════════════════════════════
// QAG_MemBrain — Interaction Quantum
// The fundamental computational primitive of the framework.
//
// An Interaction Quantum IS an AtomicMemory — it extends the base
// JSONL schema with signal-processing metadata fields.
// All existing pipeline code (CFGL, Tashi, GSAP, Neo4j, Brain)
// handles it unchanged — extra fields are ignored by layers that
// don't need them, consumed by layers that do.
//
// Signal metadata fields are first-class citizens, not afterthoughts:
//   rf_physical     — CC1101 / SX1262 transceiver configuration
//   crypto_routing  — ChaCha20-Poly1305, X25519, AODV mesh
//   temporal_index  — GSAP ticker, Doppler, RSSI, angle-of-arrival
//   temporal_tween  — tween type passed to GSAP Replay Engine
//
// RSSI → confidence score (existing CFGL field)
// Doppler shift → GSAP timeScale modulation (existing temporal layer)
// Spreading factor → cognitive weight (existing TweenAtom field)
//
// LatentSkill connection (arxiv 2606.06087):
//   skill_adapter_id field references the LoRA adapter loaded
//   at time of detection. Stored in weight space, not context.
//   64.1% fewer prefill tokens vs plaintext skill injection.
// ═══════════════════════════════════════════════════════════════════

import { AtomicMemory, AtomType, AtomSource, Importance } from "../shared/types";

// ─── RF Physical Layer (CC1101 / SX1262) ─────────────────────────────
export interface RFPhysical {
  transceiver:      "CC1101" | "SX1262" | "BLE5" | "WiFiAware" | "UWB" | "simulated";
  modulation:       "CSS" | "FSK" | "LoRa" | "BLE" | "NAN" | "none";
  frequency_hz:     number;         // e.g. 915000000 (US915), 868000000 (EU868)
  bandwidth_hz:     number;         // e.g. 125000, 250000, 500000
  spreading_factor: number;         // 7–12 for LoRa CSS
  coding_rate:      "4/5" | "4/6" | "4/7" | "4/8" | "none";
  tx_power_dbm:     number;         // max +22 dBm (SX1262)
  rx_sensitivity_dbm: number;       // e.g. -116 dBm at SF7
  regional_plan:    "US915" | "EU868" | "AU915" | "AS923" | "none";
  data_rate_bps:    number;         // up to 600,000 bps
}

// ─── Cryptographic and Mesh Routing ──────────────────────────────────
export interface CryptoRouting {
  aead:             "ChaCha20-Poly1305" | "AES-256-GCM" | "none";
  key_exchange:     "X25519-ECDH" | "none";
  fec:              "Reed-Solomon-8/16" | "none";  // Forward Error Correction
  mesh_protocol:    "AODV" | "BATMAN" | "direct" | "none";
  ttl:              number;          // Time-to-live hop count
  path_repair:      boolean;         // AODV automatic reroute
  destination_did:  string;
  hop_count:        number;
}

// ─── Temporal and Spatial Index ───────────────────────────────────────
export interface TemporalIndex {
  gsap_ticker_ms:       number;   // Absolute GSAP timeline position
  doppler_shift_hz:     number;   // Drives GSAP timeScale modulation
  rssi_dbm:             number;   // Signal strength → memory weighting
  snr_db:               number;   // Signal-to-noise → confidence
  angle_of_arrival_deg: number;   // Spatial memory palace coordinate
}

// ─── Tween specification for GSAP Replay Engine ───────────────────────
export interface TemporalTween {
  type:        "linear" | "ease" | "spring" | "elastic" | "power3.out";
  duration_ms: number;
  from_value:  number;
  to_value:    number;
  property:    string;   // which cognitive property to tween
}

// ─── Full Interaction Quantum ──────────────────────────────────────────
// Extends AtomicMemory — all base fields present, signal fields optional.
// Existing pipeline processes base fields; signal layers consume extras.
export interface InteractionQuantum extends AtomicMemory {
  // Signal metadata (undefined for non-RF quanta — fully optional)
  rf_physical?:       RFPhysical;
  crypto_routing?:    CryptoRouting;
  temporal_index?:    TemporalIndex;
  temporal_tween?:    TemporalTween;

  // LatentSkill: which weight-space adapter was active at detection time
  skill_adapter_id?:  string;

  // Vfile wrapping (A2A rich card embedding)
  vfile_version?:     "2.0";
  beep_channel?:      string;
  delegation_chain?:  string[];
}

// ─── RSSI → confidence conversion ────────────────────────────────────
// RSSI of -45 dBm (strong) → confidence ~0.98
// RSSI of -116 dBm (sensitivity floor) → confidence ~0.0
export function rssiToConfidence(rssi_dbm: number): number {
  const FLOOR = -116;  // SX1262 sensitivity floor
  const CEIL  = -30;   // typical strong signal
  return Math.max(0, Math.min(1, (rssi_dbm - FLOOR) / (CEIL - FLOOR)));
}

// ─── SNR → importance tier ────────────────────────────────────────────
export function snrToImportance(snr_db: number): Importance {
  if (snr_db >= 10) return "high";
  if (snr_db >= 5)  return "medium";
  if (snr_db >= 0)  return "low";
  return "low";  // Below 0 dB — noisy link, low confidence
}

// ─── Doppler shift → GSAP timeScale ──────────────────────────────────
// Positive Doppler (approaching) → faster cognitive processing
// Negative Doppler (receding)    → slower, more deliberate processing
// Range: [0.5, 2.5] matching the 6D engine's relativisticSpeed range
export function dopplerToTimeScale(doppler_hz: number): number {
  const normalized = doppler_hz / 100; // normalize to [-1, +1] range
  return Math.max(0.5, Math.min(2.5, 1.5 + normalized));
}

// ─── Spreading factor → cognitive weight ─────────────────────────────
// SF7 (fast, short range) → high weight (reflex tier)
// SF12 (slow, long range) → lower weight (needs cortex)
export function sfToCognitiveWeight(spreading_factor: number): number {
  return Math.max(0.1, Math.min(1.0, (13 - spreading_factor) / 6));
}

// ─── Build Interaction Quantum from RF event ──────────────────────────
// Converts a raw RF event into a full quantum with all metadata populated.
// CFGL will score it; Tashi will sign it; GSAP will consume temporal_tween.
export function buildRFQuantum(opts: {
  source_did:      string;
  destination_did: string;
  rf:              RFPhysical;
  crypto:          Partial<CryptoRouting>;
  content:         string;
  parent_hashes?:  string[];
  skill_adapter_id?: string;
}): InteractionQuantum {
  const { rf, crypto } = opts;

  const rssi       = rf.rx_sensitivity_dbm + 30; // realistic mid-range
  const snr        = 8.5;                          // typical outdoor
  const confidence = rssiToConfidence(rssi);
  const importance = snrToImportance(snr);

  const temporal_index: TemporalIndex = {
    gsap_ticker_ms:       Date.now(),
    doppler_shift_hz:     0,
    rssi_dbm:             rssi,
    snr_db:               snr,
    angle_of_arrival_deg: 0,
  };

  return {
    id:        crypto.destination_did + "_" + Date.now(),
    type:      "event" as AtomType,
    source:    "sensor" as AtomSource,
    timestamp: Date.now(),
    title:     `RF quantum: ${rf.transceiver} ${rf.modulation} ${(rf.frequency_hz/1e6).toFixed(1)}MHz`,
    content:   opts.content,
    tags:      ["rf", rf.transceiver.toLowerCase(), rf.modulation.toLowerCase(), rf.regional_plan.toLowerCase()],
    embedding: null,
    metadata: {
      confidence,
      importance,
      customer_did: opts.source_did,
    },
    parent_hashes: opts.parent_hashes ?? [],

    // Signal fields
    rf_physical:  rf,
    crypto_routing: {
      aead:            "ChaCha20-Poly1305",
      key_exchange:    "X25519-ECDH",
      fec:             "Reed-Solomon-8/16",
      mesh_protocol:   "AODV",
      ttl:             15,
      path_repair:     true,
      destination_did: opts.destination_did,
      hop_count:       0,
      ...crypto,
    },
    temporal_index,
    temporal_tween: {
      type:        "linear",
      duration_ms: 100,
      from_value:  0,
      to_value:    confidence,
      property:    "activation",
    },
    skill_adapter_id: opts.skill_adapter_id,
  };
}

// ─── Vfile wrapper ────────────────────────────────────────────────────
// Wraps a quantum for A2A transmission as Beeper rich card
export function wrapAsVfile(quantum: InteractionQuantum, beep_channel: string): object {
  return {
    vfile_version: "2.0",
    type:          "interaction_quantum",
    quantum,
    beep_channel,
    delegation_chain: [quantum.metadata.customer_did ?? "unknown"],
  };
}
