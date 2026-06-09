// ═══════════════════════════════════════════════════════════════════
// QAG_MemBrain — Unified Pipeline Implementation
//
// AUTHORITY CHAIN [L1-L6] + Temporal Substrate [L3 expanded]:
//   [L1] JSONL Atomic Memory
//   [L2] Trust (SHA-256 + Ed25519)
//   [L3a] TimelineOrchestrator — active GSAP timelines (plain objects)
//   [L3b] ContextLake          — dormant superposition store
//   [L3c] RevIkeRevival        — scrub + holographic reconstruct
//   [L3d] LiteNotebookLM       — semantic routing to temporal coordinates
//   [L4]  Neo4j + GQL SIMPLE   — GraphRAG, PageRank, precedents
//   [L5]  REV.IKE              — philosophical abstraction, off_prompt
//   [L6]  AVA-007              — sole decision authority, AtomMem CRUD
// ═══════════════════════════════════════════════════════════════════

import { v4 as uuid }                  from "uuid";
import { cfgl, appendAtom }            from "./memory/atomic_memory";
import { TashiNode }                   from "./tashi/tashi_node";
import {
  TimelineOrchestrator, ContextLake,
  RevIkeRevival, HolographicReconstructor,
  atomicMemoryToTweenAtom, RevivalResult,
}                                      from "./temporal/gsap_temporal";
import {
  LiteNotebookLM, RevivalQuery, TemporalSignature,
}                                      from "./temporal/lite_notebook_lm";
import { MemBrainGraph }               from "./retrieval/neo4j_graph";
import { RevIke }                      from "./subconscious/rev_ike";
import { Ava007 }                      from "./brain/ava007";
import { OperatorFusion }              from "./fusion/operator_fusion";
import {
  AtomicMemory, TimelineDefinition, GateConfig, DEFAULT_GATE_CONFIG,
  ObservationProposal, AVA007Decision, InMemoryTaskStore, TaskMemoryStore,
  SuperpositionGroup,
}                                      from "./shared/types";

export interface PipelineConfig {
  jsonlPath:      string;
  auditPath:      string;
  neo4jUrl:       string;
  neo4jUser:      string;
  neo4jPassword:  string;
  nodeDidCreator: string;
  privateKeyPem?: string;
  currentPolicy?: string;
  taskMemory?:    TaskMemoryStore;
  vectorSearch?:  (embedding: number[], themes: string[]) => Promise<string[]>;
}

export interface PipelineResult {
  atom_id:   string;
  proposal:  ObservationProposal;
  decision:  AVA007Decision;
  tier_used: "reflex" | "executive" | "cortex";
  total_ms:  number;
  committed: boolean;
}

export class QAGMemBrainPipeline {
  private tashi:        TashiNode;
  private graph:        MemBrainGraph;
  private config:       PipelineConfig;
  private taskMemory:   TaskMemoryStore;
  private orchestrator: TimelineOrchestrator;
  private lake:         ContextLake;
  private revival:      RevIkeRevival;
  private notebook:     LiteNotebookLM;
  private revIke:       RevIke;
  private ava007:       Ava007;
  private fusion:       OperatorFusion;

  private sessionTimeline: TimelineDefinition;

  constructor(config: PipelineConfig) {
    this.config     = config;
    this.taskMemory = config.taskMemory ?? new InMemoryTaskStore();

    this.tashi        = new TashiNode(config.nodeDidCreator, config.jsonlPath);
    this.graph        = new MemBrainGraph(config.neo4jUrl, config.neo4jUser, config.neo4jPassword);
    this.orchestrator = new TimelineOrchestrator();
    this.lake         = new ContextLake();
    this.revival      = new RevIkeRevival(this.lake);
    this.notebook     = new LiteNotebookLM(this.revival);
    this.revIke       = new RevIke(this.taskMemory);
    this.fusion       = new OperatorFusion(this.graph);
    this.ava007       = new Ava007({
      graph: this.graph, jsonlPath: config.jsonlPath,
      auditPath: config.auditPath, privateKeyPem: config.privateKeyPem,
    });

    this.sessionTimeline = {
      id: `session_${Date.now()}`, session_id: `session_${Date.now()}`,
      atoms: [], start_time: Date.now(), labels: {}, created_at: Date.now(),
    };
  }

  async init(): Promise<void> { await this.graph.initSchema(); }

  // ─── Main process loop ──────────────────────────────────────────────
  async process(rawInput: Partial<AtomicMemory>): Promise<PipelineResult> {
    const start = Date.now();

    // [L1] CFGL normalization
    const { atom } = (() => { const r = cfgl(rawInput); return { atom: r.atom }; })();

    // [L3a] GSAP tween atom → session timeline
    const tweenAtom = atomicMemoryToTweenAtom(atom, "activation", 0, atom.metadata.confidence);
    this.sessionTimeline.atoms.push(tweenAtom);
    this.orchestrator.ingest(this.sessionTimeline);

    // Auto-label high/critical atoms for easy revival
    if (["high", "critical"].includes(atom.metadata.importance)) {
      this.sessionTimeline.labels[`${atom.type}_${atom.id.slice(0,8)}`] = atom.timestamp;
    }

    // [L4] Tashi DAG
    await this.tashi.submit(atom, atom.signature ?? "unsigned");

    // [L5] REV.IKE
    const proposal = await this.revIke.detect(atom, { vectorSearch: this.config.vectorSearch });
    const offPrompt = proposal.off_prompt_context_key
      ? await this.revIke.readOffPromptContext(proposal.off_prompt_context_key)
      : null;

    // [L6] AVA-007
    const decision = await this.ava007.evaluate(
      proposal, atom, this.auditAppend.bind(this), offPrompt ?? undefined
    );
    if (decision.outcome === "ACCEPT") await this.graph.writeAtom(atom);

    const tier_used: PipelineResult["tier_used"] =
      decision.rationale.startsWith("Reflex")     ? "reflex"
      : decision.rationale.startsWith("Executive") ? "executive"
      : "cortex";

    return { atom_id: atom.id, proposal, decision, tier_used,
             total_ms: Date.now() - start, committed: decision.outcome === "ACCEPT" };
  }

  // ─── Temporal API ───────────────────────────────────────────────────

  // Archive session → Context Lake (dormant, zero CPU)
  archiveSession(tags: string[] = []): void {
    this.notebook.register({ ...this.sessionTimeline }, tags);
  }

  // Rev.Ike revival — PRIMARY THESIS: reconstruction not retrieval
  async revive(query: RevivalQuery): Promise<RevivalResult | null> {
    const result = await this.notebook.route(query);
    return result.revival;
  }

  // Holographic recall on live session (no lake lookup)
  recall(t: number): RevivalResult {
    const r = new HolographicReconstructor(this.sessionTimeline).recall(t);
    return {
      timeline_id: this.sessionTimeline.id, temporal_coordinate: t,
      reconstructed_state: r.state, fidelity: r.fidelity,
      reconstruction_ms: r.reconstruction_ms, live_state: {}, collapses: [], activated: false,
    };
  }

  // Add named temporal anchor (enables label-based revival)
  addLabel(label: string, t?: number): void {
    this.sessionTimeline.labels[label] = t ?? Date.now();
  }

  // Register + collapse superposition groups
  addSuperposition(group: SuperpositionGroup): void { this.lake.registerSuperposition(group); }
  collapse(groupId: string): SuperpositionGroup["possibilities"][0] | null {
    return this.lake.observeSuperposition(groupId);
  }

  // Mesh sync — minimal signature, remote nodes reconstruct locally
  exportSignature(t?: number): TemporalSignature | null {
    return this.notebook.exportSignature(this.sessionTimeline.id, t ?? Date.now());
  }
  importAndRevive(sig: TemporalSignature): RevivalResult | null {
    return this.notebook.importAndRevive(sig);
  }

  // ─── Operator fusion ────────────────────────────────────────────────
  async captureOperatorOverride(opts: {
    proposedAction: Record<string, unknown>;
    overrideAction: Record<string, unknown>;
    context: string; tags: string[];
  }): Promise<void> { await this.fusion.captureOverride(opts); }

  // ─── Status ─────────────────────────────────────────────────────────
  status() {
    return {
      session_atoms:    this.sessionTimeline.atoms.length,
      session_labels:   Object.keys(this.sessionTimeline.labels),
      lake_size:        this.lake.lakeSize,
      active_timelines: this.lake.activeCount,
      notebook_entries: this.notebook.notebookSize,
      revival:          this.revival.status(),
    };
  }

  private async auditAppend(record: Record<string, unknown>): Promise<void> {
    const atom: AtomicMemory = {
      id: uuid(), type: "audit", source: "system", timestamp: Date.now(),
      title: record.title as string ?? "Audit",
      content: record.content as string ?? "",
      tags: ["audit"], embedding: null,
      metadata: { confidence: 1.0, importance: "low",
        ...(typeof record.metadata === "object" ? record.metadata as object : {}) },
    };
    await appendAtom(atom, this.config.auditPath);
  }

  async close(): Promise<void> { await this.graph.close(); }
}
