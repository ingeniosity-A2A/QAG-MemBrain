/**
 * Proximity Protocols – NFC, WiFi Aware NAN, Blecon IoT, UWB NameDrop
 * Each handler converts a proximity event into an InteractionQuantum
 * and persists it via the append-only JSONL ledger.
 */
import {
  InteractionQuantum,
  buildRFQuantum,
  rssiToConfidence,
  type RFPhysical,
} from '../../quantum/interaction_quantum';
import { appendAtom } from '../../memory/atomic_memory';
import type { AtomicMemory, Importance } from '../../shared/types';

// ─── Payload types ───────────────────────────────────────────────────

export interface NFCNDEFPayload {
  type: 'text' | 'uri' | 'handshake';
  data: string;
  handshakeId?: string;
}

export interface NANDiscoveryEvent {
  peerId: string;
  serviceName: string;
  rssi_dbm: number;
  distanceEstimateCm?: number;
}

export interface BleconIoTReading {
  sensorId: string;
  payload: Record<string, unknown>;
  rssi_dbm: number;
  timestamp: number;
}

export interface UWBPosition {
  peerDid: string;
  x_cm: number;
  y_cm: number;
  z_cm: number;
  rssi_dbm: number;
}

// ─── Shared helpers ──────────────────────────────────────────────────

function importanceFromConfidence(confidence: number): Importance {
  if (confidence > 0.9) return 'critical';
  if (confidence > 0.7) return 'high';
  if (confidence > 0.4) return 'medium';
  return 'low';
}

// ─── NFC handler ─────────────────────────────────────────────────────

export async function handleNFC(
  payload: NFCNDEFPayload,
  sourceDevice: string,
): Promise<InteractionQuantum> {
  const rf: RFPhysical = {
    transceiver: 'simulated',
    modulation: 'none',
    frequency_hz: 13.56e6,
    bandwidth_hz: 0,
    spreading_factor: 0,
    coding_rate: 'none',
    tx_power_dbm: 0,
    rx_sensitivity_dbm: -30,
    regional_plan: 'none',
    data_rate_bps: 424000,
  };

  const quantum = buildRFQuantum({
    source_did: sourceDevice,
    destination_did: payload.handshakeId ?? sourceDevice,
    rf,
    crypto: { aead: 'none', key_exchange: 'none', mesh_protocol: 'direct' },
    content: JSON.stringify(payload),
  });

  quantum.metadata.confidence = 0.99;
  quantum.metadata.importance = 'high';
  (quantum as any).protocol = 'NFC';
  (quantum as any).handshakeId = payload.handshakeId;

  await appendAtom(quantum, './data/memory.jsonl');
  return quantum;
}

// ─── WiFi Aware NAN handler ──────────────────────────────────────────

export async function handleNAN(
  event: NANDiscoveryEvent,
  sourceDevice: string,
): Promise<InteractionQuantum> {
  const confidence = rssiToConfidence(event.rssi_dbm);
  const importance = importanceFromConfidence(confidence);

  const rf: RFPhysical = {
    transceiver: 'WiFiAware',
    modulation: 'NAN',
    frequency_hz: 5e9,
    bandwidth_hz: 20e6,
    spreading_factor: 0,
    coding_rate: 'none',
    tx_power_dbm: 20,
    rx_sensitivity_dbm: event.rssi_dbm,
    regional_plan: 'none',
    data_rate_bps: 0,
  };

  const quantum = buildRFQuantum({
    source_did: sourceDevice,
    destination_did: event.peerId,
    rf,
    crypto: { mesh_protocol: 'AODV' },
    content: JSON.stringify({ peerId: event.peerId, service: event.serviceName }),
  });

  quantum.metadata.confidence = confidence;
  quantum.metadata.importance = importance;
  (quantum as any).protocol = 'WiFi_Aware_NAN';
  (quantum as any).distanceCm = event.distanceEstimateCm;

  if (quantum.temporal_index) {
    quantum.temporal_index.gsap_ticker_ms = Date.now();
  }

  await appendAtom(quantum, './data/memory.jsonl');
  return quantum;
}

// ─── Blecon IoT handler ──────────────────────────────────────────────

export async function handleBlecon(
  reading: BleconIoTReading,
  sourceDevice: string,
): Promise<InteractionQuantum> {
  const confidence = rssiToConfidence(reading.rssi_dbm);
  const importance = importanceFromConfidence(confidence);

  const rf: RFPhysical = {
    transceiver: 'BLE5',
    modulation: 'BLE',
    frequency_hz: 2.4e9,
    bandwidth_hz: 2e6,
    spreading_factor: 0,
    coding_rate: 'none',
    tx_power_dbm: 10,
    rx_sensitivity_dbm: reading.rssi_dbm,
    regional_plan: 'none',
    data_rate_bps: 0,
  };

  const quantum = buildRFQuantum({
    source_did: sourceDevice,
    destination_did: reading.sensorId,
    rf,
    crypto: { aead: 'ChaCha20-Poly1305', mesh_protocol: 'direct' },
    content: JSON.stringify(reading.payload),
  });

  quantum.metadata.confidence = confidence;
  quantum.metadata.importance = importance;
  (quantum as any).protocol = 'Blecon';
  (quantum as any).sensorId = reading.sensorId;

  if (quantum.temporal_index) {
    quantum.temporal_index.gsap_ticker_ms = reading.timestamp;
  }

  await appendAtom(quantum, './data/memory.jsonl');
  return quantum;
}

// ─── UWB NameDrop handler ────────────────────────────────────────────

export async function handleUWB(
  position: UWBPosition,
  sourceDevice: string,
): Promise<InteractionQuantum> {
  const confidence = rssiToConfidence(position.rssi_dbm);

  const rf: RFPhysical = {
    transceiver: 'UWB',
    modulation: 'none',
    frequency_hz: 8e9,
    bandwidth_hz: 500e6,
    spreading_factor: 0,
    coding_rate: 'none',
    tx_power_dbm: 0,
    rx_sensitivity_dbm: position.rssi_dbm,
    regional_plan: 'none',
    data_rate_bps: 0,
  };

  const quantum = buildRFQuantum({
    source_did: sourceDevice,
    destination_did: position.peerDid,
    rf,
    crypto: { aead: 'ChaCha20-Poly1305', key_exchange: 'X25519-ECDH' },
    content: JSON.stringify({
      did: position.peerDid,
      x: position.x_cm,
      y: position.y_cm,
      z: position.z_cm,
    }),
  });

  quantum.metadata.confidence = confidence;
  quantum.metadata.importance = 'high';
  (quantum as any).protocol = 'UWB_NameDrop';

  if (quantum.temporal_index) {
    quantum.temporal_index.gsap_ticker_ms = Date.now();
  }

  await appendAtom(quantum, './data/memory.jsonl');
  return quantum;
}

// ─── Unified router ──────────────────────────────────────────────────

export type ProximityEvent =
  | { type: 'NFC'; payload: NFCNDEFPayload }
  | { type: 'NAN'; event: NANDiscoveryEvent }
  | { type: 'Blecon'; reading: BleconIoTReading }
  | { type: 'UWB'; position: UWBPosition };

export async function routeProximityEvent(
  event: ProximityEvent,
  sourceDevice: string,
): Promise<InteractionQuantum> {
  switch (event.type) {
    case 'NFC':    return handleNFC(event.payload, sourceDevice);
    case 'NAN':    return handleNAN(event.event, sourceDevice);
    case 'Blecon': return handleBlecon(event.reading, sourceDevice);
    case 'UWB':    return handleUWB(event.position, sourceDevice);
  }
}
