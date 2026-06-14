// ═══════════════════════════════════════════════════════════════════
// QUANTUM ATOMIC GSAP MEMBRAiN — Full Pipeline
//
// Input (NFC / A2A / document / webhook)
//   ↓
// Layer 0: Atomic Memory (CFGL ingestion + JSONL + Ed25519)
//   ↓
// Layer 1: Tashi DAG (sign + gossip + append)
//   ↓
// Layer 2: GSAP Temporal (tween atom + timeline + holographic recall)
//   ↓
// Layer 3: Neo4j (graph traversal + vector search)
//   ↓
// Layer 3: Dual Brain (reflex → executive → cortex)
//   ↓
// Output: RCS / speech / mesh update
//   ↓
// Audit: write decision JSONL
//   ↓
// Learning: cortex reads policy updates → updates gate config
//
// Rev. Ike boundary: between CFGL (subconscious) and Dual Brain (conscious)
// ═══════════════════════════════════════════════════════════════════

import { ingest }               from "./memory/atomic_memory";
import { TashiNode }            from "./tashi/tashi_node";
import { TimelineOrchestrator, HolographicReconstructor, atomicMemoryToTweenAtom } from "./temporal/gsap_temporal";
import { MemBrainGraph }        from "./retrieval/neo4j_graph";
import { processAtom }          from "./brain/dual_brain";
import { AtomicMemory, GateConfig, DEFAULT_GATE_CONFIG, TimelineDefinition } from "./shared/types";

// ─── Configuration ────────────────────────────────────────────────────
interface MemBrainConfig {
  jsonlPath:      string;   // Path to JSONL atomic memory file
  neo4jUrl:       string;
  neo4jUser:      string;
  neo4jPassword:  string;
  nodeDidCreator: string;   // This node's DID
  privateKeyPem?: string;   // Ed25519 private key for signing
  currentPolicy?: string;
}

// ─── Quantum Atomic GSAP MemBrain ────────────────────────────────────
export class QAGMemBrain {
  private tashi:      TashiNode;
  private orchestrator: TimelineOrchestrator;
  private graph:      MemBrainGraph;
  private config:     MemBrainConfig;
  private gateConfig: GateConfig;

  // Active timeline for the current session
  private activeTimeline: TimelineDefinition = {
    id:         `session_${Date.now()}`,
    session_id: `session_${Date.now()}`,
    atoms:      [],
    start_time: Date.now(),
    labels:     {},
    created_at: Date.now(),
  };

  constructor(config: MemBrainConfig) {
    this.config       = config;
    this.gateConfig   = DEFAULT_GATE_CONFIG;
    this.tashi        = new TashiNode(config.nodeDidCreator, config.jsonlPath);
    this.orchestrator = new TimelineOrchestrator();
    this.graph        = new MemBrainGraph(config.neo4jUrl, config.neo4jUser, config.neo4jPassword);
  }

  async init(): Promise<void> {
    await this.graph.initSchema();
  }

  // ─── Main pipeline entry point ──────────────────────────────────────
  // Every input — NFC tap, A2A POST, document upload, webhook — enters here.
  async process(rawInput: Partial<AtomicMemory>): Promise<{
    action:      string;
    tier_used:   string;
    total_ms:    number;
    atom_id:     string;
  }> {
    const pipelineStart = Date.now();

    // ── Layer 0: Atomic Memory (CFGL + JSONL + sign) ──────────────
    const { atom, cfglResult } = await ingest(rawInput, {
      filePath:      this.config.jsonlPath,
      privateKeyPem: this.config.privateKeyPem,
    });

    // ── Layer 1: Tashi DAG (sign + gossip + append) ───────────────
    const signature = atom.signature ?? "unsigned";
    const vertex    = await this.tashi.submit(atom, signature);

    // ── Layer 2: GSAP Temporal (tween atom + timeline insert) ─────
    // Convert atom to tween atom representing its confidence transition
    const tweenAtom = atomicMemoryToTweenAtom(
      atom,
      "activation",     // property: cognitive activation level
      0,                // from: dormant
      atom.metadata.confidence, // to: ingestion confidence
    );
    this.activeTimeline.atoms.push(tweenAtom);
    this.orchestrator.ingest(this.activeTimeline);

    // ── Layer 3a: Neo4j (write atom + vertex) ────────────────────
    await Promise.all([
      this.graph.writeAtom(atom),
      this.graph.writeVertex(vertex),
    ]);

    // ── Layer 3b: Dual Brain (reflex → vibe-coding → executive → cortex) ──
    const { result, tier, total_ms } = await processAtom(atom, {
      graph:        this.graph,
      auditAppend:  (record) => ingest(record as Partial<AtomicMemory>, {
        filePath: this.config.jsonlPath,
      }).then(() => {}),
      currentPolicy: this.config.currentPolicy,
      timelineSlice: this.activeTimeline.atoms.slice(-10), // last 10 tween atoms as context
      vibeLakePath:  this.config.jsonlPath,                // Vibe-coding Lake writeback
    }, this.gateConfig);

    // ── Update gate config if cortex issued a threshold change ────
    if (result.tier === "cortex" && result.output.gate_change) {
      const change = result.output.gate_change as { field: string; new_value: number };
      this.gateConfig = {
        ...this.gateConfig,
        [change.field]: change.new_value,
        last_updated:   Date.now(),
        version:        this.gateConfig.version + 1,
      };
    }

    // ── Update reflex known types if cortex identified a new type ─
    if (result.tier === "cortex" && result.output.new_known_type) {
      const newType = result.output.new_known_type as string;
      if (!this.gateConfig.reflex_known_types.includes(newType as any)) {
        this.gateConfig = {
          ...this.gateConfig,
          reflex_known_types: [...this.gateConfig.reflex_known_types, newType as any],
        };
      }
    }

    return {
      action:    result.action,
      tier_used: tier,
      total_ms:  Date.now() - pipelineStart,
      atom_id:   atom.id,
    };
  }

  // ─── Holographic recall ──────────────────────────────────────────
  recall(temporalCoordinate: number) {
    const reconstructor = new HolographicReconstructor(this.activeTimeline);
    return reconstructor.recall(temporalCoordinate);
  }

  // ─── Branch (counterfactual timeline) ───────────────────────────
  branch(branchPoint: number) {
    const reconstructor = new HolographicReconstructor(this.activeTimeline);
    return reconstructor.branch(branchPoint, []);
  }

  async close(): Promise<void> {
    await this.graph.close();
  }
}

// ─── Usage example ────────────────────────────────────────────────────
/*
const brain = new QAGMemBrain({
  jsonlPath:      "./memory.jsonl",
  neo4jUrl:       "bolt://localhost:7687",
  neo4jUser:      "neo4j",
  neo4jPassword:  "password",
  nodeDidCreator: "did:ava:node-001",
  currentPolicy:  "route NFC and known webhooks to reflex; escalate critical to cortex",
});

await brain.init();

// NFC tap — should resolve at reflex tier in <5ms
const result = await brain.process({
  type:    "event",
  source:  "nfc",
  title:   "Asset tag tap",
  content: "Tap from dock station 3 tag 0x7F3A",
  metadata: { confidence: 0.98, importance: "medium" },
});

console.log(result);
// { action: "trigger_a2a_handshake", tier_used: "reflex", total_ms: 3, atom_id: "..." }

// Recall state 30 seconds ago — holographic reconstruction
const state = brain.recall(Date.now() - 30_000);
console.log(state.fidelity); // 0.97
*/
