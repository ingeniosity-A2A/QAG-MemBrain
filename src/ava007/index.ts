import * as crypto from 'crypto';
import { MemoryStore } from '../memory/jsonl/index.js';
import { TashiSigner } from '../consensus/tashi/index.js';
import { GraphStore } from '../graph/neo4j/index.js';
import { SubconsciousObserver } from '../subconscious/index.js';
import { TemporalReplay } from '../temporal/index.js';
import { enforceAuthority } from '../contract/enforcement.js';
import { StrategicQueryTransformer, type StrategicTransformation } from './query_transform.js';
import { Ava007Orchestrator, type ProcessAtomResult } from './orchestrator.js';
import { DeterministicMellum2Client } from './mellum2.js';
import { DeterministicMercury2Client } from './mercury2.js';
import type { Atom, GateConfig, Mellum2Client, Mercury2Client } from './coordination_types.js';

export interface Decision {
  id: string;
  ts: string;
  input: unknown;
  rationale: string;
  action: string;
  confidence: number;
  signature: string;
  signerPubKey: string;
}

export class Ava007 {
  private signer: TashiSigner;
  private temporal: TemporalReplay;
  private queryTransformer: StrategicQueryTransformer;
  private orchestrator: Ava007Orchestrator;

  constructor(
    private memory: MemoryStore,
    private graph: GraphStore,
    private subconscious: SubconsciousObserver,
    pemKey?: string,
  ) {
    this.signer = new TashiSigner(pemKey);
    this.temporal = new TemporalReplay(memory);
    this.queryTransformer = new StrategicQueryTransformer(memory);
    this.orchestrator = new Ava007Orchestrator(
      memory,
      graph,
      this.signer,
      new DeterministicMellum2Client(),
      new DeterministicMercury2Client(),
    );
    enforceAuthority({ sourceLayer: 6, targetLayer: 6, action: 'execute' });
  }

  /**
   * L6 sole decision entry point (legacy/compat API).
   * For the full coordination loop, use processAtom() instead.
   */
  decide(input: unknown, rationale: string, action: string, confidence: number): Decision {
    enforceAuthority({ sourceLayer: 6, targetLayer: 6, action: 'decide' });
    if (confidence < 0 || confidence > 1) throw new Error('Confidence must be between 0 and 1');
    const id = crypto.randomUUID();
    const ts = new Date().toISOString();
    const hash = crypto.createHash('sha256')
      .update(`${id}${ts}${JSON.stringify(input)}${rationale}${action}${confidence}`)
      .digest('hex');
    const signature = this.signer.sign(hash);
    const decision: Decision = { id, ts, input, rationale, action, confidence, signature, signerPubKey: this.signer.pubKeyDer };
    this.memory.append(6, 'decision', decision);
    return decision;
  }

  /**
   * Full coordination loop: Observe → Interpret → Orchestrate → Verify → Commit → Anchor
   * Routes through Reflex → Executive (Mellum2) → Cortex (Mercury 2) tiers.
   */
  async processAtom(atom: Atom): Promise<ProcessAtomResult> {
    return this.orchestrator.processAtom(atom);
  }

  verifyDecision(decision: Decision): boolean {
    const hash = crypto.createHash('sha256')
      .update(`${decision.id}${decision.ts}${JSON.stringify(decision.input)}${decision.rationale}${decision.action}${decision.confidence}`)
      .digest('hex');
    return this.signer.verify(hash, decision.signature, decision.signerPubKey);
  }

  consult(nodeId: string): { density: number; recentEvents: number } {
    enforceAuthority({ sourceLayer: 6, targetLayer: 5, action: 'read' });
    const density = this.subconscious.patternDensity(nodeId);
    const recent = this.memory.readRange(Math.max(1, this.memory.seq - 10), Infinity);
    return { density, recentEvents: recent.length };
  }

  /**
   * Strategic Query Transformation: translate a tactical issue
   * into a philosophical search string for GraphRAG retrieval.
   * The "Prefrontal Turn" for executive control.
   */
  transformQuery(tacticalIssue: string): StrategicTransformation {
    return this.queryTransformer.transform(tacticalIssue);
  }

  static bootstrapKey(): string {
    const signer = new TashiSigner();
    return signer.exportPrivateKeyPem();
  }
}
