#!/usr/bin/env node
/**
 * QAG-MemBrain — Main Entry Point
 *
 * Wires all layers into a single runtime:
 *
 *   L1 (memory/jsonl)     → append-only SHA-256 hash chain
 *   L2 (tashi/Ed25519)    → cryptographic signing
 *   L3 (temporal/replay)   → deterministic replay + GSAP reconstructor
 *   L4 (graph/neo4j)       → graph traversal, depth <= 5
 *   L5 (subconscious)      → CFGL routing, read-only
 *   L6 (ava007+brain)      → sole decision authority
 *
 * Coordination Loop: Observe → Interpret → Orchestrate → Verify → Commit → Anchor
 * Tiers: Reflex (<5ms, no LLM) → Executive (Mellum2, ~500 tokens) → Cortex (Mercury 2, 1k+ tokens)
 *
 * Cognitive Pipeline:
 *   Atom → SubconsciousObserver.routeAtom() → DynamicPromptEngine.process()
 *        → AgentRouter.route() → Sub-Agent Dispatch → Task Memory Offloading
 */
import { Brain } from './brain/index.js';
import { MemBrainWSServer } from './ws/index.js';
import { LoRaBridge } from './hal/index.js';
import { routeProximityEvent } from './proximity/index.js';
import type { Atom } from './ava007/coordination_types.js';
import { runHarness } from './cognition/index.js';

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
  // Observe: LoRa packet → atom
  const atom: Atom = {
    id: `lora_${packet.nodeId}_${Date.now()}`,
    type: 'lora_telemetry',
    source: packet.nodeId,
    payload: { rssi: packet.rssi, snr: packet.snr, data: packet.payload },
    confidence: 0.8,
    importance: 'medium',
    tags: ['lora', 'telemetry'],
  };

  // Full coordination loop: Ava007 processAtom (Observe → Interpret → Orchestrate → Verify → Commit)
  brain.ava.processAtom(atom).then((result) => {
    console.log(`[LoRa] ${packet.nodeId} → tier=${result.tier} action=${result.action} latency=${result.latencyMs.toFixed(1)}ms`);

    // Also route through Agent Router for capability dispatch
    if (result.tier !== 'reflex') {
      brain.routeAtom(atom).then((routeResult) => {
        console.log(`[Router] ${atom.id} → target=${routeResult.task.target} handoff=${routeResult.handoffOccurred} latency=${routeResult.routingLatencyMs}ms`);
      });
    }
  });
});

// ── Proximity event handling (NFC, NAN, Blecon, UWB) ──
async function handleProximityInput() {
  // Example: simulate an NFC tap → atom → coordination loop + router
  const nfcResult = await routeProximityEvent(
    { type: 'NFC', payload: { type: 'handshake', data: 'customer_did_abc123', handshakeId: 'hs_001' } },
    'nfc_reader_1',
  );
  console.log(`[Proximity] NFC atom created: ${nfcResult.id}`);

  // Feed the proximity atom into the full coordination pipeline
  const proximityAtom: Atom = {
    id: nfcResult.id,
    type: 'nfc_tap',
    source: 'nfc_reader_1',
    payload: { type: nfcResult.type, content: nfcResult.content, confidence: nfcResult.metadata.confidence },
    confidence: nfcResult.metadata.confidence,
    importance: nfcResult.metadata.importance,
    tags: nfcResult.tags,
  };

  brain.ava.processAtom(proximityAtom).then((result) => {
    console.log(`[Proximity/Loop] tier=${result.tier} action=${result.action}`);
  });
}

// ── Cavern audio bridge ──
brain.cavern.setVelocity(0.3);
brain.cavern.on('profileUpdate', (profile) => {
  // Audio profile updates feed into cognitive perception
  brain.cognition.process({
    sensors: {},
    interaction: {},
    emotion: {},
    rhythm: {},
  });
});

// ── Cognitive State Integration ──
// The DynamicPromptEngine tracks perception state continuously.
// Any sensor update flows through: Perception → Interpretation → Assembly → Routing
brain.cognition.updateAgentStatus(
  Array.from(brain.router.getCapabilityStatus())
    .map(s => `${s.agentId}:${s.healthy ? 'ok' : 'down'}`)
    .join(', '),
);

// ── Ingestion Pipeline ──
// Transcriptions and documents flow through the ingestion pipeline
// which performs recursive chunking and persists to JSONL memory.
async function ingestDocument(text: string): Promise<void> {
  const chunks = await brain.ingestion.transcribeAndIngest(text, {
    source_url: 'direct_input',
    primary_theme: 'document_ingestion',
    lexicon_tags: ['ingestion', 'direct'],
  });
  console.log(`[Ingestion] ${chunks.length} chunks ingested`);

  // Feed ingestion completion as a cognitive state update
  brain.cognition.updateNeo4jContext(
    `Ingested ${chunks.length} chunks from direct_input at ${new Date().toISOString()}`,
  );
}

// ── Strategic Query Transformation ──
// Transform tactical issues into philosophical abstractions for GraphRAG
function demonstrateQueryTransform(): void {
  const issues = ['blocked on deployment', 'confused about architecture', 'fear of data loss'];
  for (const issue of issues) {
    const transformation = brain.ava.transformQuery(issue);
    console.log(`[QueryTransform] "${issue}" → ${transformation.target_themes.join(',')}: ${transformation.philosophical_query.slice(0, 80)}`);
  }
}

// ── Startup Banner ──
console.log(``);
console.log(`╔══════════════════════════════════════════════════════════════════╗`);
console.log(`║  Quantum Atomic GSAP MemBrain v0.7.0                           ║`);
console.log(`║  A2A-OA Cognitive Runtime                                      ║`);
console.log(`║  Data: ${DATA_DIR.padEnd(52)}║`);
console.log(`║  Memory seq: ${String(brain.memory.seq).padEnd(47)}║`);
console.log(`║  Authority: L1→L2→L3→L4→L5→L6 (Ava007 sole decision)         ║`);
console.log(`║  Loop: Observe → Interpret → Orchestrate → Verify → Commit    ║`);
console.log(`║  Tiers: Reflex (<5ms) → Executive (Mellum2) → Cortex (Mercury) ║`);
console.log(`╚══════════════════════════════════════════════════════════════════╝`);
console.log(``);

demonstrateQueryTransform();

process.on('SIGINT', () => {
  console.log('Shutting down...');
  // Garbage collect expired artifacts before exit
  const collected = brain.artifacts.gc();
  if (collected > 0) console.log(`Garbage collected ${collected} expired artifacts`);
  lora.close();
  server.close();
  process.exit(0);
});
process.on('SIGTERM', () => {
  lora.close();
  server.close();
  process.exit(0);
});
