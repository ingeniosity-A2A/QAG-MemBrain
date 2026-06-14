// ═══════════════════════════════════════════════════════════════════
// QUANTUM ATOMIC GSAP MEMBRAiN — Layer 3: Dual Brain
//
// Rev. Ike boundary sits BELOW this file.
// Everything here is conscious reasoning — CFGL is the subconscious.
//
// Reflex:    on-device (Nemotron Nano / Gemma) — rule + cache, no LLM
// Executive: Mellum2 MoE (12B/2.5B active) — routing + planning
// Cortex:    Mercury 2 diffusion — deep reasoning, policy, novel types
//
// Key Mercury 2 constraint: diffusion generates complete block.
// Context packet MUST be complete before call. No mid-call steering.
// ═══════════════════════════════════════════════════════════════════

import {
  AtomicMemory, BrainResult, CortexPacket, GateConfig,
  DEFAULT_GATE_CONFIG, BrainTier, TweenAtom,
} from "../shared/types";
import { MemBrainGraph } from "../retrieval/neo4j_graph";
import { HolographicReconstructor } from "../temporal/gsap_temporal";
import { vibeCodingMatch, routeToFable5, writeVibeToLake } from "../vibe/vibe_coding_cache";

const MELLUM2_ENDPOINT  = process.env.MELLUM2_ENDPOINT  ?? "http://localhost:11434/api/generate";
const MERCURY2_ENDPOINT = process.env.MERCURY2_ENDPOINT ?? "https://api.inceptionlabs.ai/v1/chat/completions";
const MERCURY2_API_KEY  = process.env.MERCURY2_API_KEY  ?? "";

// ════════════════════════════════════════════════════════════════════
// GATE 1: REFLEX (on-device, no LLM, <5ms)
// ════════════════════════════════════════════════════════════════════
function reflexCanHandle(atom: AtomicMemory, config: GateConfig): boolean {
  const typeKnown    = (config.reflex_known_types as string[]).includes(atom.source);
  const confOk       = atom.metadata.confidence >= config.reflex_pass_confidence;
  const importanceOk = !["critical", "high"].includes(atom.metadata.importance);
  return typeKnown && confOk && importanceOk;
}

function runReflex(atom: AtomicMemory): BrainResult {
  const start = Date.now();
  const actionMap: Record<string, string> = {
    nfc:     "trigger_a2a_handshake",
    a2a:     "route_to_agent",
    webhook: "process_webhook_payload",
  };
  return {
    tier:       "reflex",
    atom_id:    atom.id,
    action:     actionMap[atom.source] ?? "log_and_passthrough",
    output:     { cached: true, pattern_matched: atom.source },
    confidence: atom.metadata.confidence,
    model_used: "nemotron-nano-omni",
    latency_ms: Date.now() - start,
    escalate:   false,
  };
}

// ════════════════════════════════════════════════════════════════════
// GATE 2: EXECUTIVE (Mellum2 MoE — ~500 tokens)
// ════════════════════════════════════════════════════════════════════
function buildExecutivePrompt(
  atom:    AtomicMemory,
  dag:     AtomicMemory[],
  policy:  string
): string {
  const dagSummary = dag.slice(0, 5).map(a =>
    `  - [${a.type}/${a.source}] "${a.title}" conf=${a.metadata.confidence} imp=${a.metadata.importance}`
  ).join("\n");

  return `You are the Executive Brain of the QUANTUM ATOMIC GSAP MEMBRAiN system (Mellum2 MoE).
Route this atom: handle it directly, delegate to a sub-agent, or escalate to Cortex (Mercury 2).

POLICY:
${policy}

INCOMING ATOM:
  id:         ${atom.id}
  type:       ${atom.type}
  source:     ${atom.source}
  importance: ${atom.metadata.importance}
  confidence: ${atom.metadata.confidence}
  content:    ${atom.content}
  tags:       ${atom.tags.join(", ")}

ANCESTOR DAG CONTEXT (${dag.length} atoms from Neo4j):
${dagSummary || "  none — novel atom, no prior DAG context"}

Respond ONLY with valid JSON — no markdown, no preamble:
{
  "action": "<specific_action>",
  "confidence": <0.0-1.0>,
  "reasoning": "<one concise sentence>",
  "sub_agent": "<agent_id or null>"
}
If you cannot resolve with confidence >= ${DEFAULT_GATE_CONFIG.executive_pass_confidence}, set action to "escalate_to_cortex".`;
}

async function callMellum2(prompt: string): Promise<{
  action: string; confidence: number; reasoning: string; sub_agent: string | null;
}> {
  const resp = await fetch(MELLUM2_ENDPOINT, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ model: "mellum2", prompt, stream: false, format: "json" }),
  });
  if (!resp.ok) throw new Error(`Mellum2 ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  return JSON.parse(data.response);
}

export async function runExecutive(
  atom:   AtomicMemory,
  graph:  MemBrainGraph,
  config: GateConfig = DEFAULT_GATE_CONFIG,
  policy: string = "route by type, confidence, and importance",
): Promise<{ result: BrainResult; cortexPacket?: CortexPacket }> {
  const start = Date.now();

  // Pull DAG slice and check conflicts — both from Neo4j
  const [dagSlice, hasConflict] = await Promise.all([
    graph.getAncestors(atom.id, config.executive_max_dag_depth),
    graph.detectPolicyConflict(atom.id, atom.type),
  ]);

  const mellum = await callMellum2(buildExecutivePrompt(atom, dagSlice, policy));

  // Gate 2 conditions
  const escalate =
    atom.metadata.importance === "critical" ||
    hasConflict ||
    mellum.confidence < config.executive_pass_confidence ||
    mellum.action === "escalate_to_cortex";

  const escalation_reason =
    atom.metadata.importance === "critical"                      ? "importance=critical"
    : hasConflict                                                ? "policy conflict in DAG"
    : mellum.confidence < config.executive_pass_confidence      ? `confidence ${mellum.confidence} < ${config.executive_pass_confidence}`
    : mellum.action === "escalate_to_cortex"                    ? "executive self-reported inability"
    : undefined;

  const result: BrainResult = {
    tier:       "executive",
    atom_id:    atom.id,
    action:     escalate ? "escalate_to_cortex" : mellum.action,
    output:     { reasoning: mellum.reasoning, dag_depth: dagSlice.length, sub_agent: mellum.sub_agent },
    confidence: mellum.confidence,
    model_used: "mellum2-moe-12b",
    latency_ms: Date.now() - start,
    escalate,
    escalation_reason,
  };

  // Assemble COMPLETE CortexPacket before returning — no additions after this
  const cortexPacket: CortexPacket | undefined = escalate ? {
    atom,
    dag_slice:     dagSlice,
    timeline_slice: [], // populated by orchestrator from GSAP layer
    policy_context: policy,
    intent:         mellum.reasoning,
    escalation_reason: escalation_reason!,
  } : undefined;

  return { result, cortexPacket };
}

// ════════════════════════════════════════════════════════════════════
// TERMINAL: CORTEX (Mercury 2 diffusion — full timeline, 1k+ tokens)
// ════════════════════════════════════════════════════════════════════
// Mercury 2 diffusion facts:
//   - Generates COMPLETE block — no token stream
//   - Parallel refinement passes over full draft
//   - Self-correcting — each pass resolves internal conflicts
//   - Flat latency — long output costs same as short output
//   - NO mid-call steering — context must be complete before call
function buildCortexPrompt(packet: CortexPacket): string {
  const dagContext = packet.dag_slice.map((a, i) =>
    `[${i+1}] ${a.type}/${a.source} | imp=${a.metadata.importance} conf=${a.metadata.confidence}\n    ${a.content}`
  ).join("\n");

  const timelineContext = packet.timeline_slice.map(tw =>
    `  tween: ${tw.property} ${tw.from_value}→${tw.to_value} via ${tw.easing_name} (weight=${tw.cognitive_weight})`
  ).join("\n");

  // Long prompt is intentional — Mercury 2 flat latency means thoroughness is free
  return `You are the Cortex of the QUANTUM ATOMIC GSAP MEMBRAiN — Mercury 2 diffusion model.

The Executive Brain (Mellum2) could not resolve this atom. You have full context.
Your output is a complete block — reason thoroughly. Length does not increase latency.

ESCALATION REASON: ${packet.escalation_reason}
EXECUTIVE INTENT:  ${packet.intent}

POLICY CONTEXT:
${packet.policy_context}

ATOM (complete):
  id:         ${packet.atom.id}
  type:       ${packet.atom.type}
  source:     ${packet.atom.source}
  importance: ${packet.atom.metadata.importance}
  confidence: ${packet.atom.metadata.confidence}
  content:    ${packet.atom.content}
  tags:       ${packet.atom.tags.join(", ")}

DAG SLICE from Neo4j (${packet.dag_slice.length} ancestor atoms):
${dagContext || "  none — this is a genesis atom with no prior context"}

GSAP TEMPORAL CONTEXT (active tween atoms):
${timelineContext || "  none — no active timeline for this memory"}

RESPONSIBILITIES:
1. Decide the correct action
2. If type is novel (no DAG match), define a new routing rule
3. If policy conflict, resolve it — state which policy wins and why
4. If a gate threshold should change, specify the update
5. Be thorough — parallel diffusion passes will self-correct inconsistencies

Respond ONLY with valid JSON — no markdown:
{
  "action": "<specific_action>",
  "confidence": <0.0-1.0>,
  "reasoning": "<detailed explanation>",
  "policy_update": {
    "required": <boolean>,
    "change": "<description or null>",
    "new_known_type": "<source string to add to reflex set, or null>",
    "gate_threshold_change": { "field": "<field_name>", "new_value": <number> } | null
  }
}`;
}

async function callMercury2(prompt: string): Promise<{
  action: string;
  confidence: number;
  reasoning: string;
  policy_update: {
    required:              boolean;
    change:                string | null;
    new_known_type:        string | null;
    gate_threshold_change: { field: string; new_value: number } | null;
  };
}> {
  const resp = await fetch(MERCURY2_ENDPOINT, {
    method:  "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${MERCURY2_API_KEY}` },
    body:    JSON.stringify({
      model:      "mercury-coder-small",
      messages:   [{ role: "user", content: prompt }],
      max_tokens: 1024,
      // No stream — Mercury 2 diffusion returns complete block
    }),
  });
  if (!resp.ok) throw new Error(`Mercury2 ${resp.status}: ${await resp.text()}`);
  const data  = await resp.json();
  const raw   = data.choices[0]?.message?.content ?? "";
  return JSON.parse(raw);
}

export async function runCortex(
  packet: CortexPacket,
  graph:  MemBrainGraph,
  auditAppend: (record: Record<string, unknown>) => Promise<void>,
): Promise<BrainResult> {
  const start = Date.now();

  // Hard validation — diffusion cannot recover from incomplete context
  const missing = ["atom", "escalation_reason", "policy_context"]
    .filter(k => !(packet as any)[k]);
  if (missing.length > 0) {
    throw new Error(`Cortex received incomplete packet. Missing: ${missing.join(", ")}. ` +
      "Executive must assemble full context before escalating.");
  }

  const prompt = buildCortexPrompt(packet);
  const output = await callMercury2(prompt);

  // Write policy update to Neo4j graph if required
  if (output.policy_update.required && output.policy_update.change) {
    await graph.writePolicyUpdate(
      packet.atom,
      output.policy_update.change,
      output.policy_update.new_known_type ?? undefined
    );
    // Also write to audit JSONL for learning loop
    await auditAppend({
      type: "policy_update", source: "cortex",
      title: "Cortex policy update",
      content: output.policy_update.change,
      timestamp: Date.now(),
      metadata: {
        importance: "high",
        confidence: output.confidence,
        triggered_by: packet.atom.id,
        new_known_type: output.policy_update.new_known_type,
        gate_change: output.policy_update.gate_threshold_change,
      },
    });
  }

  return {
    tier:       "cortex",
    atom_id:    packet.atom.id,
    action:     output.action,
    output: {
      reasoning:              output.reasoning,
      policy_update_required: output.policy_update.required,
      new_known_type:         output.policy_update.new_known_type,
      gate_change:            output.policy_update.gate_threshold_change,
      dag_depth:              packet.dag_slice.length,
    },
    confidence: output.confidence,
    model_used: "mercury-2-diffusion",
    latency_ms: Date.now() - start,
    escalate:   false, // cortex is terminal — no further escalation
  };
}

// ════════════════════════════════════════════════════════════════════
// ORCHESTRATOR — full pipeline entry point
// ════════════════════════════════════════════════════════════════════
export async function processAtom(
  atom: AtomicMemory,
  deps: {
    graph:        MemBrainGraph;
    auditAppend:  (record: Record<string, unknown>) => Promise<void>;
    currentPolicy?: string;
    timelineSlice?: TweenAtom[];  // GSAP temporal context from Layer 2
    vibeLakePath?: string;       // JSONL path for Vibe-Coding Lake writeback
  },
  config: GateConfig = DEFAULT_GATE_CONFIG,
): Promise<{ result: BrainResult; tier: BrainTier; total_ms: number }> {
  const start = Date.now();

  async function writeAudit(result: BrainResult) {
    await deps.auditAppend({
      type: "audit", source: "brain",
      title: `${result.tier}: ${result.action}`,
      content: JSON.stringify(result.output),
      timestamp: Date.now(),
      metadata: {
        importance:        result.escalate ? "high" : "medium",
        confidence:        result.confidence,
        brain_tier:        result.tier,
        model_used:        result.model_used,
        latency_ms:        result.latency_ms,
        atom_id:           atom.id,
        atom_type:         atom.type,
        escalated:         result.escalate,
        escalation_reason: result.escalation_reason ?? null,
      },
    });
  }

  // Gate 1: Reflex
  if (reflexCanHandle(atom, config)) {
    const result = runReflex(atom);
    await writeAudit(result);
    return { result, tier: "reflex", total_ms: Date.now() - start };
  }

  // ── Zero-Latency Vibe-Coding Check ─────────────────────────────────
  // Single Map.get() per keyword. O(1). Adds <0.01ms on non-match.
  // On match: bypasses Mellum2 entirely → saves ~500ms.
  // On non-match: falls through to Gate 2 as normal.
  const vibeMatch = vibeCodingMatch(atom);
  if (vibeMatch.matched && vibeMatch.scenario) {
    try {
      const vibeResult = await routeToFable5(atom, vibeMatch.scenario);
      await writeAudit(vibeResult);

      // Write to Context Lake (Gist Cavern) for persistence
      if (deps.vibeLakePath) {
        await writeVibeToLake(atom, vibeResult, deps.vibeLakePath);
      }

      // If validation failed, escalate to executive for review
      if (!vibeResult.escalate) {
        return { result: vibeResult, tier: "reflex", total_ms: Date.now() - start };
      }
      // Validation failed — fall through to Gate 2
    } catch {
      // Fable 5 call failed — fall through to Gate 2 (resilience fallback)
    }
  }

  // Gate 2: Executive
  const { result: execResult, cortexPacket } = await runExecutive(
    atom, deps.graph, config, deps.currentPolicy
  );
  await writeAudit(execResult);

  if (!execResult.escalate) {
    return { result: execResult, tier: "executive", total_ms: Date.now() - start };
  }

  // Terminal: Cortex — inject GSAP timeline slice into packet
  const packet: CortexPacket = {
    ...cortexPacket!,
    timeline_slice: deps.timelineSlice ?? [],
  };

  const cortexResult = await runCortex(packet, deps.graph, deps.auditAppend);
  await writeAudit(cortexResult);

  return { result: cortexResult, tier: "cortex", total_ms: Date.now() - start };
}
