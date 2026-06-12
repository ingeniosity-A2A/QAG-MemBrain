// ═══════════════════════════════════════════════════════════════════
// QAG_MemBrain — Proximity Layer
// App-less handshake protocols:
//   Tier 1: UWB / NameDrop — AI vCard exchange
//   Tier 2: NFC — invisible sticker re-engagement
//   Tier 3: Wi-Fi Aware NAN — cross-platform, no router needed
//   Tier 4: Blecon BLE-to-cloud — IoT sensor roaming
//   Tier 5: A2A-BEEP — semantic agent-to-agent POST
//
// Each tier writes an AtomicMemory to the JSONL ledger.
// Tashi gossips the vertex to the mesh.
// Pipeline processes the atom through L1→L6.
// ═══════════════════════════════════════════════════════════════════

import { v4 as uuid } from "uuid";
import { AtomicMemory } from "../shared/types";

// ─── Tier 1: UWB / NameDrop — AI vCard ───────────────────────────────
// User brings devices close → direct DID exchange + AI-optimized vCard
// vCard contains agentic prompt in AGENT field (RFC 6350 extension)
export interface AIVCard {
  display_name:   string;
  did:            string;    // did:ava:node-xxx
  a2a_endpoint:   string;    // https://ai.example.com/a2a
  agent_prompt:   string;    // "POST service requests to {a2a_endpoint}"
  service_types:  string[];
  preferred_rcs:  string;    // E.164
}

export function buildVCard(card: AIVCard): string {
  return [
    "BEGIN:VCARD", "VERSION:4.0",
    `FN:${card.display_name}`,
    `X-DID:${card.did}`,
    `X-A2A-ENDPOINT:${card.a2a_endpoint}`,
    `X-AGENT-PROMPT:${card.agent_prompt}`,
    `X-SERVICE-TYPES:${card.service_types.join(",")}`,
    `TEL;TYPE=cell:${card.preferred_rcs}`,
    "END:VCARD",
  ].join("\r\n");
}

export function vCardToAtom(card: AIVCard): Partial<AtomicMemory> {
  return {
    id:        uuid(),
    type:      "event",
    source:    "nfc",      // UWB/NameDrop treated as proximity event
    title:     `AI vCard: ${card.display_name}`,
    content:   `DID=${card.did} A2A=${card.a2a_endpoint} Services=${card.service_types.join(",")}`,
    tags:      ["vcard", "proximity", "uwb", ...card.service_types],
    metadata:  { confidence: 1.0, importance: "high", customer_did: card.did },
  };
}

// ─── Tier 2: NFC Sticker ─────────────────────────────────────────────
// Physical NFC tag on furniture/equipment → service re-engagement
// NDEF record contains JSON payload parsed at ingestion
export interface NFCPayload {
  asset_id:     string;
  asset_type:   string;    // "furniture", "equipment", "location"
  service_type: string;    // "assembly", "repair", "inspection"
  customer_did: string;
  deep_link:    string;    // fallback URL for non-NFC browsers
}

export function nfcToAtom(payload: NFCPayload): Partial<AtomicMemory> {
  return {
    id:        uuid(),
    type:      "event",
    source:    "nfc",
    title:     `NFC: ${payload.asset_type} ${payload.service_type}`,
    content:   `Asset ${payload.asset_id} requests ${payload.service_type}`,
    tags:      ["nfc", "sticker", payload.asset_type, payload.service_type],
    metadata:  {
      confidence:   1.0,
      importance:   "medium",
      customer_did: payload.customer_did,
      url:          payload.deep_link,
    },
  };
}

// ─── Tier 3: Wi-Fi Aware NAN ──────────────────────────────────────────
// IEEE 802.11aq — cross-platform (iOS + Android), no router, no internet
// EU Digital Markets Act mandates this open standard (replaces AWDL)
// Wi-Fi Aware 4.0 "Instant Communication Mode" achieves <50ms discovery
//
// Browser/Node cannot directly control Wi-Fi NAN hardware.
// This module defines the JSON payload contract for the native bridge.
// Native app (Android Aware API / iOS Wi-Fi Aware) calls this endpoint.
export interface NANServiceInfo {
  service_name: string;    // max 255 bytes — broadcast via NAN
  service_type: "publish" | "subscribe";
  custom_info:  string;    // JSON payload in service-specific info field
  ttl_ms:       number;    // how long to broadcast
}

export interface NANDiscoveryEvent {
  peer_did:      string;
  service_name:  string;
  rssi:          number;   // signal strength
  custom_info:   string;   // JSON from peer's publish record
  timestamp:     number;
}

export function nanDiscoveryToAtom(event: NANDiscoveryEvent): Partial<AtomicMemory> {
  let parsed: Record<string, unknown> = {};
  try { parsed = JSON.parse(event.custom_info); } catch {}

  return {
    id:        uuid(),
    type:      "event",
    source:    "a2a",
    title:     `Wi-Fi Aware: ${event.service_name}`,
    content:   `Peer ${event.peer_did} discovered via NAN. RSSI=${event.rssi}. ${event.custom_info.slice(0,100)}`,
    tags:      ["wifi_aware", "nan", "proximity", event.service_name],
    metadata:  {
      confidence:   Math.min(1.0, (event.rssi + 100) / 70),  // RSSI → confidence
      importance:   "medium",
      customer_did: event.peer_did,
      ...parsed as object,
    },
  };
}

// ─── Tier 4: Blecon BLE-to-Cloud ──────────────────────────────────────
// IoT sensors roam across any available hotspot without 1:1 BLE pairing
// Device → Blecon hotspot → cloud endpoint → JSONL atom
// Range: ~100m indoor (standard BLE), ~1km (BLE 5 Coded PHY)
export interface BleconEvent {
  device_id:     string;   // Blecon device identifier
  realm_url:     string;   // cloud realm endpoint
  payload:       Record<string, unknown>;
  rssi:          number;
  hotspot_id:    string;   // which phone/hub routed this
  timestamp:     number;
}

export function bleconToAtom(event: BleconEvent): Partial<AtomicMemory> {
  return {
    id:        uuid(),
    type:      "sensor",
    source:    "nfc",       // treated as proximity sensor class
    title:     `Blecon: device ${event.device_id.slice(0,8)}`,
    content:   JSON.stringify({ device: event.device_id, ...event.payload }),
    tags:      ["blecon", "ble", "sensor", "iot"],
    metadata:  {
      confidence:  Math.min(1.0, (event.rssi + 100) / 70),
      importance:  "low",
      url:         event.realm_url,
    },
  };
}

// ─── Tier 5: A2A-BEEP Protocol ────────────────────────────────────────
// User tells personal AI (Gemini / ChatGPT / Siri):
//   "Book assembly at ai.helpassembly.com"
// AI POSTs to endpoint → Ava-007 receives structured JSON-RPC task
// This is the "semantic prompt as service trigger" pattern
export interface BEEPTask {
  jsonrpc:    "2.0";
  method:     "message/send";
  id:         string;
  params: {
    message: {
      role:   "user";
      parts:  Array<{ kind: "text"; text: string }>;
    };
  };
}

export function buildBEEPTask(userIntent: string): BEEPTask {
  return {
    jsonrpc: "2.0",
    method:  "message/send",
    id:      uuid(),
    params:  {
      message: {
        role:  "user",
        parts: [{ kind: "text", text: userIntent }],
      },
    },
  };
}

export function beepToAtom(task: BEEPTask, fromAgentDid?: string): Partial<AtomicMemory> {
  const text = task.params.message.parts.map(p => p.text).join(" ");
  return {
    id:        uuid(),
    type:      "conversation",
    source:    "a2a",
    title:     `A2A-BEEP: ${text.slice(0, 60)}`,
    content:   text,
    tags:      ["a2a", "beep", "agent_to_agent"],
    metadata:  {
      confidence:   0.92,
      importance:   "high",
      customer_did: fromAgentDid,
    },
  };
}

// ─── Proximity event router ───────────────────────────────────────────
// Single entry point — detects payload type, returns normalized AtomicMemory
export type ProximityPayload =
  | { tier: "uwb";    data: AIVCard }
  | { tier: "nfc";    data: NFCPayload }
  | { tier: "nan";    data: NANDiscoveryEvent }
  | { tier: "blecon"; data: BleconEvent }
  | { tier: "beep";   data: BEEPTask; from_did?: string };

export function routeProximityEvent(event: ProximityPayload): Partial<AtomicMemory> {
  switch (event.tier) {
    case "uwb":    return vCardToAtom(event.data);
    case "nfc":    return nfcToAtom(event.data);
    case "nan":    return nanDiscoveryToAtom(event.data);
    case "blecon": return bleconToAtom(event.data);
    case "beep":   return beepToAtom(event.data, event.from_did);
  }
}
