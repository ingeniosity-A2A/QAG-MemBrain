/**
 * Proximity Protocols - NFC, WiFi Aware NAN, Blecon IoT, UWB NameDrop
 * Converts proximity events into AtomicMemory and persists via JSONL ledger.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// ─── Inline types (avoids importing broken root-level modules) ───────

type Importance = 'low' | 'medium' | 'high' | 'critical';

interface AtomicMemory {
  id: string;
  type: string;
  source: string;
  timestamp: number;
  title: string;
  content: string;
  tags: string[];
  embedding: number[] | null;
  metadata: {
    confidence: number;
    importance: Importance;
    [key: string]: unknown;
  };
}

async function appendAtom(atom: AtomicMemory, filePath: string): Promise<void> {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  return new Promise((resolve, reject) => {
    const stream = fs.createWriteStream(filePath, { flags: 'a', encoding: 'utf8' });
    stream.write(JSON.stringify(atom) + '\n', (err) => {
      stream.close();
      err ? reject(err) : resolve();
    });
  });
}

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

function rssiToConfidence(rssi: number): number {
  const FLOOR = -116;
  const CEIL = -30;
  return Math.max(0, Math.min(1, (rssi - FLOOR) / (CEIL - FLOOR)));
}

function importanceFromConfidence(confidence: number): Importance {
  if (confidence > 0.9) return 'critical';
  if (confidence > 0.7) return 'high';
  if (confidence > 0.4) return 'medium';
  return 'low';
}

function makeProximityAtom(opts: {
  source: string;
  destination: string;
  protocol: string;
  frequency_hz: number;
  rssi_dbm: number;
  content: string;
  extra?: Record<string, unknown>;
}): AtomicMemory {
  const confidence = rssiToConfidence(opts.rssi_dbm);
  return {
    id: `prox_${opts.protocol}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
    type: 'sensor',
    source: 'nfc',
    timestamp: Date.now(),
    title: `Proximity: ${opts.protocol} from ${opts.source}`,
    content: opts.content,
    tags: ['proximity', opts.protocol.toLowerCase()],
    embedding: null,
    metadata: {
      confidence,
      importance: importanceFromConfidence(confidence),
      customer_did: opts.source,
      ...opts.extra,
    },
  };
}

// ─── NFC handler ─────────────────────────────────────────────────────

export async function handleNFC(
  payload: NFCNDEFPayload,
  sourceDevice: string,
): Promise<AtomicMemory> {
  const atom = makeProximityAtom({
    source: sourceDevice,
    destination: payload.handshakeId ?? sourceDevice,
    protocol: 'NFC',
    frequency_hz: 13.56e6,
    rssi_dbm: -30,
    content: JSON.stringify(payload),
    extra: { handshakeId: payload.handshakeId },
  });
  atom.metadata.confidence = 0.99;
  atom.metadata.importance = 'high';
  await appendAtom(atom, './data/memory.jsonl');
  return atom;
}

// ─── WiFi Aware NAN handler ──────────────────────────────────────────

export async function handleNAN(
  event: NANDiscoveryEvent,
  sourceDevice: string,
): Promise<AtomicMemory> {
  const atom = makeProximityAtom({
    source: sourceDevice,
    destination: event.peerId,
    protocol: 'WiFi_Aware_NAN',
    frequency_hz: 5e9,
    rssi_dbm: event.rssi_dbm,
    content: JSON.stringify({ peerId: event.peerId, service: event.serviceName }),
    extra: { distanceCm: event.distanceEstimateCm },
  });
  await appendAtom(atom, './data/memory.jsonl');
  return atom;
}

// ─── Blecon IoT handler ──────────────────────────────────────────────

export async function handleBlecon(
  reading: BleconIoTReading,
  sourceDevice: string,
): Promise<AtomicMemory> {
  const atom = makeProximityAtom({
    source: sourceDevice,
    destination: reading.sensorId,
    protocol: 'Blecon',
    frequency_hz: 2.4e9,
    rssi_dbm: reading.rssi_dbm,
    content: JSON.stringify(reading.payload),
    extra: { sensorId: reading.sensorId },
  });
  await appendAtom(atom, './data/memory.jsonl');
  return atom;
}

// ─── UWB NameDrop handler ────────────────────────────────────────────

export async function handleUWB(
  position: UWBPosition,
  sourceDevice: string,
): Promise<AtomicMemory> {
  const atom = makeProximityAtom({
    source: sourceDevice,
    destination: position.peerDid,
    protocol: 'UWB_NameDrop',
    frequency_hz: 8e9,
    rssi_dbm: position.rssi_dbm,
    content: JSON.stringify({
      did: position.peerDid,
      x: position.x_cm,
      y: position.y_cm,
      z: position.z_cm,
    }),
  });
  atom.metadata.importance = 'high';
  await appendAtom(atom, './data/memory.jsonl');
  return atom;
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
): Promise<AtomicMemory> {
  switch (event.type) {
    case 'NFC':    return handleNFC(event.payload, sourceDevice);
    case 'NAN':    return handleNAN(event.event, sourceDevice);
    case 'Blecon': return handleBlecon(event.reading, sourceDevice);
    case 'UWB':    return handleUWB(event.position, sourceDevice);
  }
}
