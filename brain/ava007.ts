// ═══════════════════════════════════════════════════════════════════
// QAG_MemBrain — AVA-007 (Layer 6, Sole Decision Authority)
//
// New in unified v1.1:
//   - AtomMem CRUD: GRPO-trained self-managing memory policy
//     Model granted XML-token action space: create/read/update/delete
//   - Operator precedent injection before every decision
//   - off_prompt context reading from REV.IKE TaskMemory
//   - Prefix cache awareness: static atoms share prefix_key
//   - Mercury2 diffusion: complete block, flat latency, self-correcting
// ═══════════════════════════════════════════════════════════════════

import { v4 as uuid } from "uuid";
import {
  AtomicMemory, BrainResult, CortexPacket, GateConfig, DEFAULT_GATE_CONFIG,
  AVA007Decision, ObservationProposal, AtomMemDirective, PrecedentResult,
} from "../shared/types";
import {
  LAYERS, assertCanDecide, assertCanExecute, assertCanWrite,
  ContractViolation, CONTRACT_VERSION,
} from "../contract/enforcement";
import { MemBrainGraph } from "../retrieval/neo4j_graph";
import { OperatorFusion } from "../fusion/operator_fusion";
import { sha256, signAtom, appendAtom } from "../memory/atomic_memory";

const MELLUM2_ENDPOINT  = process.env.MELLUM2_ENDPOINT  ?? "http://localhost:11434/api/generate";
const MERCURY2_ENDPOINT = process.env.MERCURY2_ENDPOINT ?? "https://api.inceptionlabs.ai/v1/chat/completions";
const MERCURY2_API_KEY  = process.env.MERCURY2_API_KEY  ?? "";

// ─── AtomMem CRUD policy prompt builder ──────────────────────────────
// GRPO trains the model to proactively manage its own memory context.
// Model emits XML-token directives alongside its decision.
function buildAtomMemPromptSection(): string {
  return `
ATOM MEMORY MANAGEMENT (AtomMem CRUD policy):
You may issue memory management directives alongside your decision.
Use these XML tokens when needed — do not use them unless necessary:
  <create_memory>{ "content": "...", "tags": [...] }</create_memory>
  <read_memory>{ "atom_id": "..." }</read_memory>
  <update_memory>{ "atom_id": "...", "content": "..." }</update_memory>
  <delete_memory>{ "atom_id": "..." }</delete_memory>

When to use:
  - CREATE: when you detect a novel pattern worth persisting
  - UPDATE: when existing memory has become outdated
  - DELETE: when redundant atoms are polluting context
  - READ:   when you need a specific atom before deciding`;
}

// ─── Parse AtomMem directives from model output ───────────────────────
function parseAtomMemDirectives(raw: string): AtomMemDirective[] {
  const directives: AtomMemDirective[] = [];
  const pattern = /<(create|read|update|delete)_memory>([\s\S]*?)<\/\1_memory>/g;
  let match;
  while ((match = pattern.exec(raw)) !== null) {
    try {
      const action = `${match[1]}_memory` as AtomMemDirective["action"];
      const payload = JSON.parse(match[2]);
      directives.push({ action, atom_id: payload.atom_id, payload, rationale: payload.rationale ?? "" });
    } catch { /* malformed directive — skip */ }
  }
  return directives;
}

export class Ava007 {
  private readonly layer = LAYERS.AVA_007;
  private config:  GateConfig;
  private graph:   MemBrainGraph;
  private fusion:  OperatorFusion;
  private jsonlPath:     string;
  private auditPath:     string;
  private privateKeyPem: string | undefined;

  constructor(opts: {
    graph:         MemBrainGraph;
    jsonlPath:     string;
    auditPath:     string;
    privateKeyPem?: string;
    config?:       GateConfig;
  }) {
    this.graph         = opts.graph;
    this.jsonlPath     = opts.jsonlPath;
    this.auditPath     = opts.auditPath;
    this.privateKeyPem = opts.privateKeyPem;
    this.config        = opts.config ?? DEFAULT_GATE_CONFIG;
    this.fusion        = new OperatorFusion(opts.graph);
  }

  // ─── Core decision entry point ──────────────────────────────────────
  async evaluate(
    proposal:          ObservationProposal,
    atom:              AtomicMemory,
    auditAppend:       (r: Record<string, unknown>) => Promise<void>,
    offPromptContext?: string,  // read from REV.IKE TaskMemory
  ): Promise<AVA007Decision> {
    assertCanDecide(this.layer);

    // 1. Fetch graph context (SIMPLE restrictor — no join bombs)
    const [ancestors, hasConflict] = await Promise.all([
      this.graph.getAncestors(atom.id, this.config.executive_max_dag_depth, "SIMPLE"),
      this.graph.detectPolicyConflict(atom.id, atom.type),
    ]);

    // 2. Fetch operator precedents — inject operator intuition
    const precedents = await this.fusion.fetchPrecedents(
      `${atom.content} ${atom.tags.join(" ")}`, 2
    );

    // 3. Route: reflex → executive (Mellum2 GRPO) → cortex (Mercury2)
    const { outcome, rationale, memory_action, atom_mem_directives } =
      await this.route(proposal, atom, ancestors, hasConflict, precedents, offPromptContext);

    const decision: AVA007Decision = {
      id:            uuid(),
      decided_by:    "AVA-007",
      layer:         this.layer,
      timestamp:     Date.now(),
      proposal_id:   proposal.id,
      outcome,
      rationale,
      memory_action,
      precedents_used: precedents,
    };

    // 4. Execute decision
    assertCanExecute(this.layer);

    if (outcome === "ACCEPT") {
      await this.commitMemory(atom);
    }

    // 5. Execute AtomMem CRUD directives
    await this.executeAtomMemDirectives(atom_mem_directives ?? [], auditAppend);

    // 6. Audit log
    await auditAppend({
      type: "audit", source: "ava-007",
      title: `AVA-007: ${outcome} — ${proposal.proposed_action}`,
      content: rationale,
      timestamp: Date.now(),
      metadata: {
        importance: outcome === "ACCEPT" ? "high" : "medium",
        confidence: 1.0,
        decided_by: "AVA-007",
        proposal_id: proposal.id,
        atom_id: atom.id,
        outcome, memory_action,
        precedents_count: precedents.length,
        atom_mem_directives: atom_mem_directives?.length ?? 0,
        contract_version: CONTRACT_VERSION,
      },
    });

    return decision;
  }

  // ─── Memory commit (ACCEPT path only) ──────────────────────────────
  private async commitMemory(atom: AtomicMemory): Promise<void> {
    assertCanWrite(this.layer);
    const vertex_hash = sha256(atom);
    let signed = { ...atom, vertex_hash };
    if (this.privateKeyPem) {
      signed = { ...signed, signature: signAtom(signed, this.privateKeyPem) };
    }
    await appendAtom(signed, this.jsonlPath);
    await this.graph.writeAtom(signed);
  }

  // ─── AtomMem CRUD execution ─────────────────────────────────────────
  // Model's self-managing memory policy — runs after each decision
  private async executeAtomMemDirectives(
    directives:  AtomMemDirective[],
    auditAppend: (r: Record<string, unknown>) => Promise<void>,
  ): Promise<void> {
    for (const d of directives) {
      assertCanWrite(this.layer);
      switch (d.action) {
        case "create_memory":
          if (d.payload) {
            const newAtom: AtomicMemory = {
              id:        uuid(),
              type:      d.payload.type ?? "memory",
              source:    "system",
              timestamp: Date.now(),
              title:     d.payload.title ?? "AtomMem creation",
              content:   d.payload.content ?? "",
              tags:      d.payload.tags ?? ["atom_mem"],
              embedding: null,
              metadata:  { confidence: 0.9, importance: "medium" },
            };
            await appendAtom(newAtom, this.jsonlPath);
            await this.graph.writeAtom(newAtom);
          }
          break;
        case "update_memory":
          // In production: mark old atom as superseded, append updated version
          if (d.atom_id && d.payload) {
            await auditAppend({
              type: "audit", source: "ava-007",
              title: `AtomMem UPDATE: ${d.atom_id}`,
              content: d.payload.content ?? "",
              timestamp: Date.now(),
              metadata: { importance: "low", confidence: 1.0, supersedes: d.atom_id },
            });
          }
          break;
        case "delete_memory":
          // JSONL is append-only — "delete" = tombstone record
          if (d.atom_id) {
            await auditAppend({
              type: "audit", source: "ava-007",
              title: `AtomMem TOMBSTONE: ${d.atom_id}`,
              content: `Marked for deletion: ${d.rationale}`,
              timestamp: Date.now(),
              metadata: { importance: "low", confidence: 1.0, tombstone: d.atom_id },
            });
          }
          break;
        case "read_memory":
          // Read access is always allowed — no-op in execution
          break;
      }
    }
  }

  // ─── Routing logic ──────────────────────────────────────────────────
  private async route(
    proposal:    ObservationProposal,
    atom:        AtomicMemory,
    ancestors:   AtomicMemory[],
    hasConflict: boolean,
    precedents:  PrecedentResult[],
    offPromptContext?: string,
  ): Promise<{
    outcome: "ACCEPT" | "REJECT";
    rationale: string;
    memory_action: AVA007Decision["memory_action"];
    atom_mem_directives?: AtomMemDirective[];
  }> {
    // Reflex: fast path — no LLM
    if (
      !proposal.anomaly &&
      proposal.confidence >= this.config.reflex_pass_confidence &&
      atom.metadata.importance !== "critical" &&
      !hasConflict &&
      precedents.length === 0  // No conflicting precedent
    ) {
      return {
        outcome:       "ACCEPT",
        rationale:     `Reflex accept. Pattern=${proposal.pattern} conf=${proposal.confidence}`,
        memory_action: "sign_and_append",
      };
    }

    // Executive: Mellum2 with GRPO self-correction + precedent injection
    const execResult = await this.callMellum2(
      proposal, atom, ancestors, precedents, offPromptContext
    );

    if (
      execResult.confidence >= this.config.executive_pass_confidence &&
      execResult.outcome === "ACCEPT"
    ) {
      return {
        outcome:              "ACCEPT",
        rationale:            `Executive (Mellum2 GRPO): ${execResult.rationale}`,
        memory_action:        "sign_and_append",
        atom_mem_directives:  execResult.atom_mem_directives,
      };
    }

    // Cortex: Mercury2 diffusion — critical, conflicted, or low-confidence
    const cortexResult = await this.callMercury2(
      proposal, atom, ancestors, precedents, offPromptContext
    );
    return {
      outcome:             cortexResult.outcome,
      rationale:           `Cortex (Mercury2): ${cortexResult.rationale}`,
      memory_action:       cortexResult.outcome === "ACCEPT" ? "sign_and_append"
                         : cortexResult.audit ? "audit_only" : "discard",
      atom_mem_directives: cortexResult.atom_mem_directives,
    };
  }

  // ─── Mellum2 (GRPO — executive tier) ────────────────────────────────
  private async callMellum2(
    proposal:    ObservationProposal,
    atom:        AtomicMemory,
    ancestors:   AtomicMemory[],
    precedents:  PrecedentResult[],
    offPrompt?:  string,
  ): Promise<{
    outcome: "ACCEPT" | "REJECT"; confidence: number; rationale: string;
    atom_mem_directives?: AtomMemDirective[];
  }> {
    const dagCtx = ancestors.slice(0, 5)
      .map(a => `  [${a.type}] "${a.title}" conf=${a.metadata.confidence}`)
      .join("\n");

    const precedentCtx = this.fusion.formatPrecedentsForPrompt(precedents);

    // off_prompt context referenced by summary — full tokens in TaskMemory
    const contextRef = offPrompt
      ? `\nSUBCONSCIOUS CONTEXT (summary):\n${offPrompt.slice(0, 400)}...[full context in TaskMemory]`
      : "";

    const prompt = `You are AVA-007's Executive Engine (Mellum2, GRPO-tuned). Sole decision authority.
Evaluate this proposal. ACCEPT or REJECT.

REV.IKE PROPOSAL:
  pattern:         ${proposal.pattern}
  anomaly:         ${proposal.anomaly}
  insight:         ${proposal.insight}
  proposed_action: ${proposal.proposed_action}
  confidence:      ${proposal.confidence}

ATOM:
  type: ${atom.type} | source: ${atom.source} | importance: ${atom.metadata.importance}
  content: ${atom.content.slice(0, 200)}

ANCESTOR DAG (${ancestors.length} atoms):
${dagCtx || "  none"}

OPERATOR PRECEDENTS:
${precedentCtx}
${contextRef}

${buildAtomMemPromptSection()}

Respond with JSON then any AtomMem XML directives:
{ "outcome": "ACCEPT"|"REJECT", "confidence": <0.0-1.0>, "rationale": "<one sentence>" }`;

    try {
      const resp = await fetch(MELLUM2_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body:   JSON.stringify({ model: "mellum2", prompt, stream: false }),
      });
      if (!resp.ok) throw new Error(`Mellum2 ${resp.status}`);
      const data = await resp.json();
      const raw  = data.response ?? "";
      const jsonMatch = raw.match(/\{[\s\S]*?\}/);
      const parsed    = jsonMatch ? JSON.parse(jsonMatch[0]) : { outcome: "REJECT", confidence: 0, rationale: "parse error" };
      const atom_mem_directives = parseAtomMemDirectives(raw);
      return { ...parsed, atom_mem_directives };
    } catch (e) {
      return { outcome: "REJECT", confidence: 0, rationale: `Mellum2 error: ${e}` };
    }
  }

  // ─── Mercury2 diffusion (cortex tier) ──────────────────────────────
  // Complete block output — flat latency — parallel self-correction passes
  private async callMercury2(
    proposal:   ObservationProposal,
    atom:       AtomicMemory,
    ancestors:  AtomicMemory[],
    precedents: PrecedentResult[],
    offPrompt?: string,
  ): Promise<{
    outcome: "ACCEPT" | "REJECT"; rationale: string; audit: boolean;
    atom_mem_directives?: AtomMemDirective[];
  }> {
    const dagCtx = ancestors.map((a, i) =>
      `[${i+1}] ${a.type}/${a.source} imp=${a.metadata.importance}\n    ${a.content.slice(0,100)}`
    ).join("\n");

    const precedentCtx = this.fusion.formatPrecedentsForPrompt(precedents);
    const contextRef   = offPrompt ? offPrompt.slice(0, 800) : "none";

    // Long prompt intentional — Mercury2 diffusion: flat latency, thoroughness free
    const userPrompt = `You are AVA-007's Cortex (Mercury2 diffusion). Sole authority.
Executive could not resolve this — you make the final decision.

PROPOSAL: ${proposal.proposed_action} | pattern: ${proposal.pattern} | anomaly: ${proposal.anomaly}
INSIGHT: ${proposal.insight}

ATOM: type=${atom.type} source=${atom.source} importance=${atom.metadata.importance}
CONTENT: ${atom.content}
TAGS: ${atom.tags.join(", ")}

DAG ANCESTRY (${ancestors.length}):
${dagCtx || "  none — genesis atom"}

OPERATOR PRECEDENTS:
${precedentCtx}

SUBCONSCIOUS CONTEXT (from REV.IKE TaskMemory):
${contextRef}

${buildAtomMemPromptSection()}

Be thorough. Diffusion passes self-correct inconsistencies. Length does not increase latency.

Respond with JSON then any AtomMem XML directives:
{ "outcome": "ACCEPT"|"REJECT", "rationale": "<detailed>", "audit": <boolean> }`;

    try {
      const resp = await fetch(MERCURY2_ENDPOINT, {
        method:  "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${MERCURY2_API_KEY}` },
        body:    JSON.stringify({
          model:      "mercury-coder-small",
          messages:   [{ role: "user", content: userPrompt }],
          max_tokens: 1024,
        }),
      });
      if (!resp.ok) throw new Error(`Mercury2 ${resp.status}`);
      const data = await resp.json();
      const raw  = data.choices[0]?.message?.content ?? "";
      const jsonMatch = raw.match(/\{[\s\S]*?\}/);
      const parsed    = jsonMatch ? JSON.parse(jsonMatch[0]) : { outcome: "REJECT", rationale: "parse error", audit: true };
      const atom_mem_directives = parseAtomMemDirectives(raw);
      return { ...parsed, atom_mem_directives };
    } catch (e) {
      return { outcome: "REJECT", rationale: `Mercury2 error: ${e}`, audit: true };
    }
  }

  updateGateConfig(patch: Partial<GateConfig>): void {
    assertCanExecute(this.layer);
    this.config = { ...this.config, ...patch, last_updated: Date.now(), version: this.config.version + 1 };
  }
}
