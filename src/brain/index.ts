import { MemoryStore } from '../memory/jsonl/index.js';
import { TashiSigner } from '../consensus/tashi/index.js';
import { GraphStore } from '../graph/neo4j/index.js';
import { SubconsciousObserver } from '../subconscious/index.js';
import { TemporalReplay } from '../temporal/index.js';
import { Ava007, type Decision } from '../ava007/index.js';

export interface BrainConfig { dataDir: string; signerKeyPem?: string; }

export class Brain {
  public readonly memory: MemoryStore;
  public readonly signer: TashiSigner;
  public readonly graph: GraphStore;
  public readonly subconscious: SubconsciousObserver;
  public readonly temporal: TemporalReplay;
  public readonly ava: Ava007;

  constructor(config: BrainConfig) {
    this.memory = new MemoryStore(config.dataDir, 'brain.jsonl');
    this.signer = new TashiSigner(config.signerKeyPem);
    this.graph = new GraphStore(this.memory);
    this.subconscious = new SubconsciousObserver(this.memory, this.graph);
    this.temporal = new TemporalReplay(this.memory);
    this.ava = new Ava007(this.memory, this.graph, this.subconscious, config.signerKeyPem);
  }

  process(input: unknown): Decision {
    this.memory.append(1, 'input', input);
    const signals = this.ava.consult('root');
    const decision = this.ava.decide(
      input,
      `Subconscious density: ${signals.density}, recent events: ${signals.recentEvents}`,
      'process',
      Math.min(1, 0.5 + signals.density * 0.5),
    );
    if (decision.confidence >= 0.7) {
      this.graph.addNode({ id: decision.id, label: 'decision', properties: { action: decision.action, confidence: decision.confidence } });
    }
    return decision;
  }
}
