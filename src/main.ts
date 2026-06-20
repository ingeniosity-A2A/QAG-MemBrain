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
import { TelnyxBridge } from './telnyx/index.js';
import { exec } from 'child_process';

// ─── Backhaul Failover Manager ───────────────────────────────────────
type BackhaulType = 'cellular' | 'loramesh';

class BackhaulManager {
  private currentBackhaul: BackhaulType = 'cellular';
  private loraBridge: LoRaBridge;
  private onSwitchCallbacks: Array<(newBackhaul: BackhaulType) => void> = [];
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private pingHost: string;
  private heartbeatMs: number;

  constructor(loraBridge: LoRaBridge) {
    this.loraBridge = loraBridge;
    this.pingHost = process.env.CELLULAR_PING_HOST || '8.8.8.8';
    this.heartbeatMs = parseInt(process.env.BACKHAUL_HEARTBEAT_INTERVAL_MS || '30000', 10);
    this.startCellularHeartbeat();
  }

  private startCellularHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      if (this.currentBackhaul === 'loramesh') {
        exec(`ping -c 1 -W 2 ${this.pingHost}`, (error) => {
          if (!error) {
            console.log('[Backhaul] Cellular recovered — switching back...');
            this.switchToCellular();
          }
        });
      }
    }, this.heartbeatMs);
  }

  switchToLoRa(): void {
    if (this.currentBackhaul === 'loramesh') return;
    console.log('[Backhaul] Switching to LoRa mesh backhaul');
    this.currentBackhaul = 'loramesh';
    if (!this.loraBridge.isActive) {
      this.loraBridge.start().catch((err: Error) =>
        console.error(`[Backhaul] LoRa start failed: ${err.message}`),
      );
    }
    this.notifySwitch('loramesh');
  }

  switchToCellular(): void {
    if (this.currentBackhaul === 'cellular') return;
    console.log('[Backhaul] Switching back to cellular backhaul');
    this.currentBackhaul = 'cellular';
    if (this.loraBridge.isActive) {
      this.loraBridge.stop();
    }
    this.notifySwitch('cellular');
  }

  private notifySwitch(backhaul: BackhaulType): void {
    process.env.ACTIVE_BACKHAUL = backhaul;
    for (const cb of this.onSwitchCallbacks) cb(backhaul);
  }

  onSwitch(cb: (backhaul: BackhaulType) => void): void { this.onSwitchCallbacks.push(cb); }
  getCurrent(): BackhaulType { return this.currentBackhaul; }

  destroy(): void {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
  }
}

const PORT = parseInt(process.env.PORT || '8080', 10);
const DATA_DIR = process.env.DATA_DIR || './data';
const SIGNER_KEY = process.env.AVA007_SIGNER_PRIVATE_KEY_PEM;

if (!SIGNER_KEY) {
  console.warn('WARNING: AVA007_SIGNER_PRIVATE_KEY_PEM not set - using ephemeral dev key.');
}

const brain = new Brain();

// ── Telnyx SMS/Voice Bridge ──
const TELNYX_API_KEY = process.env.TELNYX_API_KEY;
const TELNYX_PHONE = process.env.TELNYX_PHONE_NUMBER || '+14044391350';
const TELNYX_MESSAGING_PROFILE = process.env.TELNYX_MESSAGING_PROFILE_ID;

let telnyx: TelnyxBridge | undefined;
if (TELNYX_API_KEY) {
  telnyx = new TelnyxBridge();
  telnyx.attach((data: any) => {});
  console.log(`Telnyx bridge: ${TELNYX_PHONE} (SMS + Voice → AgentRouter)`);
} else {
  console.warn('WARNING: TELNYX_API_KEY not set — SMS/Voice bridge disabled.');
}

const server = new MemBrainWSServer();

// ── Cloudflare Tunnel ──
const CLOUDFLARE_TUNNEL_TOKEN = process.env.CLOUDFLARE_TUNNEL_TOKEN;
if (CLOUDFLARE_TUNNEL_TOKEN) {
  import('child_process').then(({ spawn }) => {
    const tunnel = spawn('cloudflared', ['tunnel', 'run', '--token', CLOUDFLARE_TUNNEL_TOKEN], {
      stdio: 'inherit',
      detached: false,
    });
    tunnel.on('error', (err: Error) => console.error(`[Cloudflare] Tunnel error: ${err.message}`));
    tunnel.on('exit', (code: number) => console.log(`[Cloudflare] Tunnel exited with code ${code}`));
    console.log('[Cloudflare] Tunnel starting...');
  });
} else {
  console.warn('WARNING: CLOUDFLARE_TUNNEL_TOKEN not set — external access disabled. Use `cloudflared tunnel --url http://localhost:3000` for quick tunnel.');
}

// ── LoRa Bridge (ESP32 serial or mock) ──
const lora = new LoRaBridge(
  process.env.LORA_SERIAL_PORT || '/dev/ttyUSB0',
  parseInt(process.env.LORA_BAUD_RATE || '115200', 10),
);
lora.open().then(() => {
  console.log(`LoRa bridge: ${lora.isMockMode ? 'MOCK' : 'SERIAL'} mode`);
});

// ── Backhaul Failover (SIGUSR1 → LoRa mesh, SIGUSR2 → cellular) ──
const backhaul = new BackhaulManager(lora);

backhaul.onSwitch((newBackhaul) => {
  console.log(`[Main] Backhaul switched to ${newBackhaul}`);
  process.env.ACTIVE_BACKHAUL = newBackhaul;
});

process.on('SIGUSR1', () => {
  console.log('[Main] SIGUSR1 — switching to LoRa mesh backhaul');
  backhaul.switchToLoRa();
});

process.on('SIGUSR2', () => {
  console.log('[Main] SIGUSR2 — switching to cellular backhaul');
  backhaul.switchToCellular();
});

lora.onPacket((packet: any) => {
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
  brain.ava.processAtom(atom).then((result: any) => {
    console.log(`[LoRa] ${packet.nodeId} → tier=${result.tier} action=${result.action} latency=${result.latencyMs.toFixed(1)}ms`);

    // Also route through Agent Router for capability dispatch
    if (result.tier !== 'reflex') {
      brain.routeAtom(atom).then((routeResult: any) => {
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
  console.log(`[Proximity] NFC atom created: ${nfcResult?.id || 'unknown'}`);

  // Feed the proximity atom into the full coordination pipeline
  const proximityAtom: Atom = {
    id: 'nfc_atom_001',
    type: 'nfc_tap',
    source: 'nfc_reader_1',
    payload: { type: 'NFC', content: 'Handshake data', confidence: 0.8 },
    confidence: 0.8,
    importance: 'medium',
    tags: ['nfc', 'handshake'],
  };

  brain.ava.processAtom(proximityAtom).then((result: any) => {
    console.log(`[Proximity/Loop] tier=${result.tier} action=${result.action}`);
  });
}

// ── Cavern audio bridge ──
brain.cavern.setVelocity(0.3);
brain.cavern.on('profileUpdate', (profile: any) => {
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
console.log(`║  Telnyx: ${(telnyx ? TELNYX_PHONE : 'disabled').padEnd(53)}║`);
console.log(`║  Tunnel: ${(CLOUDFLARE_TUNNEL_TOKEN ? 'Cloudflare' : 'local-only').padEnd(53)}║`);
console.log(`║  Backhaul: ${backhaul.getCurrent().padEnd(51)}║`);
console.log(`║  Device: ${(process.env.EDGE_DEVICE_DID || 'unknown').padEnd(53)}║`);
console.log(`╚══════════════════════════════════════════════════════════════════╝`);
console.log(``);

demonstrateQueryTransform();

process.on('SIGINT', () => {
  console.log('Shutting down...');
  const collected = brain.artifacts.gc();
  if (collected > 0) console.log(`Garbage collected ${collected} expired artifacts`);
  backhaul.destroy();
  lora.close();
  server.close();
  process.exit(0);
});
process.on('SIGTERM', () => {
  backhaul.destroy();
  lora.close();
  server.close();
  process.exit(0);
});
