import { MemoryStore } from '../../memory/jsonl/index.js';
import { TashiSigner } from '../consensus/tashi/index.js';
import { GraphStore } from '../../memory/graph/neo4j/index.js';
import { SubconsciousObserver } from '../../memory/subconscious/index.js';
import { TemporalReplay, GSAPTemporalReconstructor } from '../../memory/temporal/index.js';
import { Ava007, type Decision } from '../ava007/index.js';
import { IngestionPipeline } from '../../memory/ingestion/index.js';
import { CavernBridge } from '../../integrations/audio/index.js';
import { DynamicPromptEngine, AgentRouter, TaskArtifactManager } from '../cognition/index.js';
import type { OrchestratorConstraints, HandoffThresholds, AgentExecutor } from '../cognition/index.js';
import type { Atom } from '../ava007/coordination_types.js';

export interface BrainConfig {
  dataDir: string;
  signerKeyPem?: string;
  /** Optional constraints for the cognitive runtime. */
  cognitiveConstraints?: Partial<OrchestratorConstraints>;
  /** Optional handoff thresholds for Task Memory offloading. */
  handoffThresholds?: Partial<HandoffThresholds>;
  /** Optional custom agent executors (override deterministic stubs). */
  customExecutors?: AgentExecutor[];
}

export class Brain {
  public readonly memory: MemoryStore;
  public readonly signer: TashiSigner;
  public readonly graph: GraphStore;
  public readonly subconscious: SubconsciousObserver;
  public readonly temporal: TemporalReplay;
  public readonly gsapReplay: GSAPTemporalReconstructor;
  public readonly ingestion: IngestionPipeline;
  public readonly cavern: CavernBridge;
  public readonly ava: Ava007;
  public readonly cognition: DynamicPromptEngine;
  public readonly router: AgentRouter;
  public readonly artifacts: TaskArtifactManager;

  constructor(config: BrainConfig) {
    this.memory = new MemoryStore(config.dataDir, 'brain.jsonl');
    this.signer = new TashiSigner(config.signerKeyPem);
    this.graph = new GraphStore(this.memory);
    this.subconscious = new SubconsciousObserver(this.memory, this.graph);
    this.temporal = new TemporalReplay(this.memory);
    this.cavern = new CavernBridge();
    this.gsapReplay = new GSAPTemporalReconstructor(this.memory, this.cavern);
    this.ingestion = new IngestionPipeline(this.memory);
    this.ava = new Ava007(this.memory, this.graph, this.subconscious, config.signerKeyPem);
    this.cognition = new DynamicPromptEngine(this.memory, config.cognitiveConstraints);
    this.artifacts = new TaskArtifactManager(this.memory, config.handoffThresholds, `${config.dataDir}/artifacts`);
    this.router = new AgentRouter(this.memory, this.artifacts, config.cognitiveConstraints, config.customExecutors);
  }

  /**
   * Legacy synchronous decision API.
   * For the full coordination loop, use ava.processAtom() instead.
   * For capability dispatch, use routeAtom().
   */
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

  /**
   * Route an atom through the full Agent Router pipeline.
   * This is the primary entry point for the A2A-OA executive switchboard:
   *   Atom → ObservationProposal → Capability Matching → Handoff → Dispatch
   */
  async routeAtom(atom: Atom): Promise<import('../cognition/observation_types.js').RoutingResult> {
    return this.router.routeAtom(atom);
  }
}
