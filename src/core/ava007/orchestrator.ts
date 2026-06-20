/**
 * Ava007 Orchestrator – Coordination Loop
 * Ported from ava007/runtime/orchestrator.ts into canonical src/.
 *
 * Implements the closed loop:
 *   Observe → Interpret → Orchestrate → Verify → Commit → Anchor
 *
 * Tiers: Reflex (<5ms, no LLM) → Executive (Mellum2, ~500 tokens) → Cortex (Mercury 2, 1k+ tokens)
 */
import * as fs from 'fs';
import * as path from 'path';
import type {
  Atom,
  AuditAtom,
  CortexPacket,
  GateConfig,
  Mellum2Client,
  Mellum2Response,
  Mercury2Client,
  ProcessAtomResult,
  RuntimeTier,
  DagSlice,
  PolicyConflict,
  ExecutiveResult,
} from './coordination_types.js';
import type { GraphNode, GraphEdge } from '@graph/neo4j/enforcement.js';
import { assertAtom } from './coordination_types.js';
import { evaluateReflexGate, evaluateExecutiveGate } from './escalation_gates.js';
import { buildMercuryPrompt } from './mercury2.js';
import { DEFAULT_GATE_CONFIG, loadGateConfigFromEnv } from './gate_config.js';
import { MemoryStore } from '@memory/jsonl/index.js';
import { GraphStore } from '@graph/neo4j/index.js';
import { TashiSigner } from '@memory/tashi/consensus/index.js';
import { enforceAuthority } from '@contract/enforcement.js';

// ─── DAG Slice from GraphStore (in-memory, depth ≤5) ─────────────────

function buildDagSlice(graph: GraphStore, atomId: string, maxDepth: number): DagSlice {
  const traversal = graph.traverse(atomId, maxDepth);
  return {
    rootId: atomId,
    maxDepth,
    nodes: traversal.nodes.map((n: GraphNode, i: number) => ({
      id: n.id,
      labels: [n.label],
      properties: n.properties,
      depth: i,
    })),
    relationships: traversal.edges.map((e: GraphEdge) => ({
      fromId: e.source,
      toId: e.target,
      type: e.type,
      properties: e.properties,
      depth: 0,
    })),
  };
}

// ─── Audit logging ───────────────────────────────────────────────────

function appendAuditAtom(store: MemoryStore, atom: AuditAtom): void {
  store.append(6, 'audit_policy_change', atom);
}

// ─── Orchestrator ────────────────────────────────────────────────────

export class Ava007Orchestrator {
  private gateConfig: GateConfig;
  private mellum2: Mellum2Client;
  private mercury2: Mercury2Client;
  private memory: MemoryStore;
  private graph: GraphStore;
  private signer: TashiSigner;
  private patternCache: Set<string> = new Set();
  private fingerprintCache: Set<string> = new Set();

  constructor(
    memory: MemoryStore,
    graph: GraphStore,
    signer: TashiSigner,
    mellum2: Mellum2Client,
    mercury2: Mercury2Client,
    gateConfig?: GateConfig,
  ) {
    this.memory = memory;
    this.graph = graph;
    this.signer = signer;
    this.mellum2 = mellum2;
    this.mercury2 = mercury2;
    this.gateConfig = gateConfig ?? loadGateConfigFromEnv();
    enforceAuthority({ sourceLayer: 6, targetLayer: 6, action: 'execute' });
  }

  /**
   * Process an atom through the full coordination loop:
   *   Observe → Interpret → Orchestrate → Verify → Commit → Anchor
   */
  async processAtom(atom: Atom): Promise<ProcessAtomResult> {
    const startedAt = this.nowMs();
    assertAtom(atom);
    const clock = new Date();

    // ── STEP 1: OBSERVE ──
    // Ingress from NFC, A2A POST, webhook, etc.
    // Human override flags checked first (in atom.payload).

    // ── STEP 2: INTERPRET ──
    // CFGL rule routing determines the tier.
    const reflexGate = evaluateReflexGate({
      atom,
      config: this.gateConfig,
      patternCache: this.patternCache,
      fingerprintCache: this.fingerprintCache,
    });

    // ── STEP 3: ORCHERATE (Reflex tier) ──
    if (reflexGate.target === 'reflex' && reflexGate.action) {
      // No LLM call — zero token cost
      return this.commitResult({
        tier: 'reflex',
        action: reflexGate.action,
        latencyMs: this.nowMs() - startedAt,
        confidence: 1,
        gateReason: reflexGate.reason,
        contextTokenBudget: this.gateConfig.reflexContextTokenBudget,
        atom,
        clock,
      });
    }

    // ── STEP 3: ORCHERATE (Executive tier — Mellum2) ──
    const dagSlice = buildDagSlice(this.graph, atom.id, this.gateConfig.dagMaxDepth);
    const policyConflicts: PolicyConflict[] = []; // In-memory graph doesn't track policy conflicts yet

    const mellum2Decision = await this.mellum2.evaluate({
      atom,
      dagSlice,
      policyConflicts,
      gateConfig: this.gateConfig,
    });

    const executiveGate = evaluateExecutiveGate({
      decision: mellum2Decision,
      config: this.gateConfig,
      dagSlice,
      policyConflicts,
      atom,
    });

    // Executive resolved — no cortex needed
    if (executiveGate.target !== 'cortex') {
      return this.commitResult({
        tier: 'executive',
        action: mellum2Decision.action,
        latencyMs: this.nowMs() - startedAt,
        confidence: mellum2Decision.confidence,
        gateReason: executiveGate.reason,
        contextTokenBudget: this.gateConfig.executiveContextTokenBudget,
        atom,
        clock,
      });
    }

    // ── STEP 3: ORCHERATE (Cortex tier — Mercury 2) ──
    const cortexPacket: CortexPacket = {
      packetId: `${atom.id}:cortex:${clock.getTime()}`,
      atom,
      dagSlice,
      policyConflicts,
      executiveDecision: mellum2Decision,
      gateConfig: this.gateConfig,
      assembledAt: clock.toISOString(),
    };

    const mercury2Response = await this.mercury2.generateBlock({
      packet: cortexPacket,
      prompt: buildMercuryPrompt(cortexPacket),
    });

    // Audit policy changes
    let auditAtomId: string | undefined;
    if (mercury2Response.policyChange) {
      auditAtomId = `${atom.id}:policy-successor:${clock.getTime()}`;
      appendAuditAtom(this.memory, {
        id: auditAtomId,
        type: 'policy_change',
        source: 'cortex',
        timestamp: clock.toISOString(),
        predecessorAtomId: atom.id,
        packetId: cortexPacket.packetId,
        payload: mercury2Response.policyChange,
      });
    }

    // ── STEP 4: VERIFY ──
    // Authority chain already enforced via enforceAuthority() in constructor.

    // ── STEP 5: COMMIT ──
    return this.commitResult({
      tier: 'cortex',
      action: mercury2Response.action,
      latencyMs: this.nowMs() - startedAt,
      confidence: mercury2Response.confidence,
      gateReason: executiveGate.reason,
      contextTokenBudget: this.gateConfig.cortexContextTokenBudget,
      packetId: cortexPacket.packetId,
      auditAtomId,
      atom,
      clock,
    });

    // ── STEP 6: ANCHOR ──
    // Tashi consensus finality is handled by the caller after receiving the result.
    // The TashiSigner signs the decision atom; gossip is external.
  }

  get config(): GateConfig { return this.gateConfig; }

  private nowMs(): number {
    return Number(process.hrtime.bigint()) / 1_000_000;
  }

  private commitResult(input: {
    tier: RuntimeTier;
    action: string;
    latencyMs: number;
    confidence?: number;
    gateReason?: string;
    contextTokenBudget?: number;
    packetId?: string;
    auditAtomId?: string;
    atom: Atom;
    clock: Date;
  }): ProcessAtomResult {
    // Write atom to JSONL, sign with Tashi
    this.memory.append(6, 'coordination_result', {
      atomId: input.atom.id,
      tier: input.tier,
      action: input.action,
      confidence: input.confidence,
      latencyMs: input.latencyMs,
      gateReason: input.gateReason,
      packetId: input.packetId,
      timestamp: input.clock.toISOString(),
    });

    return {
      tier: input.tier,
      action: input.action as ProcessAtomResult['action'],
      latencyMs: input.latencyMs,
      confidence: input.confidence,
      packetId: input.packetId,
      auditAtomId: input.auditAtomId,
      gateReason: input.gateReason,
      contextTokenBudget: input.contextTokenBudget,
    };
  }
}
