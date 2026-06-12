#!/usr/bin/env node
import { Brain } from './brain/index.js';
import { MemBrainWSServer } from './ws/index.js';
import { LoRaBridge } from './hal/index.js';
import { routeProximityEvent } from './proximity/protocols.js';
import type { Atom } from './ava007/coordination_types.js';

const PORT = parseInt(process.env.PORT || '8080', 10);
const DATA_DIR = process.env.DATA_DIR || './data';
const SIGNER_KEY = process.env.AVA007_SIGNER_PRIVATE_KEY_PEM;

if (!SIGNER_KEY) {
  console.warn('WARNING: AVA007_SIGNER_PRIVATE_KEY_PEM not set - using ephemeral dev key.');
}

const brain = new Brain({ dataDir: DATA_DIR, signerKeyPem: SIGNER_KEY });
const server = new MemBrainWSServer({ port: PORT, brain });

// ── LoRa Bridge (ESP32 serial or mock) ──
const lora = new LoRaBridge('/dev/ttyUSB0', 115200);
lora.open().then(() => {
  console.log(`LoRa bridge: ${lora.isMockMode ? 'MOCK' : 'SERIAL'} mode`);
});

lora.onPacket((packet) => {
  // Observe: LoRa packet → atom → coordination loop
  const atom: Atom = {
    id: `lora_${packet.nodeId}_${Date.now()}`,
    type: 'lora_telemetry',
    source: packet.nodeId,
    payload: { rssi: packet.rssi, snr: packet.snr, data: packet.payload },
    confidence: 0.8,
    importance: 'medium',
    tags: ['lora', 'telemetry'],
  };

  brain.ava.processAtom(atom).then((result) => {
    console.log(`[LoRa] ${packet.nodeId} → tier=${result.tier} action=${result.action} latency=${result.latencyMs.toFixed(1)}ms`);
  });
});

// ── Proximity event handling ──
async function handleProximityInput() {
  // Example: simulate an NFC tap
  const nfcResult = await routeProximityEvent(
    { type: 'NFC', payload: { type: 'handshake', data: 'customer_did_abc123', handshakeId: 'hs_001' } },
    'nfc_reader_1',
  );
  console.log(`[Proximity] NFC atom created: ${nfcResult.id}`);
}

// ── Cavern audio bridge ──
brain.cavern.setVelocity(0.3);
brain.cavern.on('profileUpdate', (profile) => {
  // Audio profile updates are logged at L1
});

console.log(`Quantum Atomic GSAP MemBrain v0.1.0 | Data: ${DATA_DIR} | Seq: ${brain.memory.seq}`);
console.log(`Coordination Loop: Observe → Interpret → Orchestrate → Verify → Commit → Anchor`);
console.log(`Tiers: Reflex (<5ms) → Executive (Mellum2) → Cortex (Mercury 2)`);

process.on('SIGINT', () => {
  console.log('Shutting down...');
  lora.close();
  server.close();
  process.exit(0);
});
process.on('SIGTERM', () => {
  lora.close();
  server.close();
  process.exit(0);
});
