import { BrainResult, BrainTier, MemoryAtom } from "../shared/types.js";
import { GateConfig, loadGateConfig } from "../shared/gate_config.js";
import { runExecutive } from "../executive/executive.js";
import { runCortex } from "../cortex/cortex.js";

function reflexCanHandle(atom: MemoryAtom, config: GateConfig): boolean {
  const typeKnown = (config.reflex_known_types as string[]).includes(atom.type);
  const confidenceOk = atom.metadata.confidence >= config.reflex_pass_confidence;
  const importanceOk =
    atom.metadata.importance !== "critical" && atom.metadata.importance !== "high";
  return typeKnown && confidenceOk && importanceOk;
}

async function writeAuditRecord(
  result: BrainResult,
  atom: MemoryAtom,
  auditAppend: (record: Record<string, unknown>) => Promise<void>,
): Promise<void> {
  await auditAppend({
    type: "audit",
    source: "brain",
    title: `${result.tier} decision: ${result.action}`,
    content: JSON.stringify(result.output),
    timestamp: Date.now(),
    metadata: {
      importance: "medium",
      confidence: result.confidence,
      brain_tier: result.tier,
      model_used: result.model_used,
      latency_ms: result.latency_ms,
      atom_id: atom.id,
      atom_type: atom.type,
      escalated: result.escalate,
      escalation_reason: result.escalation_reason ?? null,
    },
  });
}

async function runReflex(atom: MemoryAtom): Promise<BrainResult> {
  const start = Date.now();
  const actionMap: Record<string, string> = {
    nfc_tap: "trigger_a2a_handshake",
    a2a_post: "route_to_agent",
    webhook_known: "process_webhook_payload",
  };
  const action = actionMap[atom.type] ?? "log_and_passthrough";

  return {
    tier: "reflex",
    atom_id: atom.id,
    action,
    output: { cached: true, pattern_matched: atom.type },
    confidence: atom.metadata.confidence,
    model_used: "on-device-nemotron-nano",
    latency_ms: Date.now() - start,
    escalate: false,
  };
}

export async function processAtom(
  atom: MemoryAtom,
  deps: {
    neo4jDriver: unknown;
    auditAppend: (record: Record<string, unknown>) => Promise<void>;
    currentPolicy?: string;
  },
): Promise<{
  result: BrainResult;
  tier_used: BrainTier;
  total_latency_ms: number;
}> {
  const start = Date.now();
  const config = await loadGateConfig(deps.neo4jDriver);

  if (reflexCanHandle(atom, config)) {
    const result = await runReflex(atom);
    await writeAuditRecord(result, atom, deps.auditAppend);
    return {
      result,
      tier_used: "reflex",
      total_latency_ms: Date.now() - start,
    };
  }

  const { result: execResult, cortexPacket } = await runExecutive(
    atom,
    deps.neo4jDriver,
    config,
    deps.currentPolicy,
  );

  await writeAuditRecord(execResult, atom, deps.auditAppend);

  if (!execResult.escalate) {
    return {
      result: execResult,
      tier_used: "executive",
      total_latency_ms: Date.now() - start,
    };
  }

  if (!cortexPacket) {
    throw new Error("Executive set escalate=true but did not produce a CortexPacket");
  }

  const cortexResult = await runCortex(cortexPacket, deps.auditAppend);
  await writeAuditRecord(cortexResult, atom, deps.auditAppend);

  return {
    result: cortexResult,
    tier_used: "cortex",
    total_latency_ms: Date.now() - start,
  };
}
