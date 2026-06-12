import * as crypto from 'crypto';
import { MemoryStore } from '../memory/jsonl/index.js';
import { TashiSigner } from '../consensus/tashi/index.js';
import { GraphStore } from '../graph/neo4j/index.js';
import { SubconsciousObserver } from '../subconscious/index.js';
import { TemporalReplay } from '../temporal/index.js';
import { enforceAuthority } from '../contract/enforcement.js';

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

  constructor(
    private memory: MemoryStore,
    private graph: GraphStore,
    private subconscious: SubconsciousObserver,
    pemKey?: string,
  ) {
    this.signer = new TashiSigner(pemKey);
    this.temporal = new TemporalReplay(memory);
    enforceAuthority({ sourceLayer: 6, targetLayer: 6, action: 'execute' });
  }

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

  static bootstrapKey(): string {
    const signer = new TashiSigner();
    return signer.exportPrivateKeyPem();
  }
}
