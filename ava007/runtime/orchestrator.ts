import { loadGateConfig } from "./gate_config.js";
import { runCortex } from "./cortex.js";
import { runExecutive } from "./executive.js";
import { evaluateReflexGate } from "./escalation_gates.js";
import { appendTierAuditRecord } from "./tier_audit.js";
import { Atom, ProcessAtomDeps, ProcessAtomResult, RuntimeAction, RuntimeTier, assertAtom } from "./types.js";

function nowMs(): number {
  return Number(process.hrtime.bigint()) / 1_000_000;
}

async function auditedResult(input: {
  atom: Atom;
  deps: ProcessAtomDeps;
  tier: RuntimeTier;
  action: RuntimeAction;
  gateReason: string;
  contextTokenBudget: number;
  latencyMs: number;
  timestamp: string;
  confidence?: number;
  packetId?: string;
  auditAtomId?: string;
}): Promise<ProcessAtomResult> {
  await appendTierAuditRecord(input.deps.auditLogPath, {
    id: `${input.atom.id}:tier:${input.timestamp}`,
    type: "tier_decision",
    atomId: input.atom.id,
    tier: input.tier,
    action: input.action,
    gateReason: input.gateReason,
    confidence: input.confidence,
    contextTokenBudget: input.contextTokenBudget,
    latencyMs: input.latencyMs,
    timestamp: input.timestamp,
  });

  return {
    tier: input.tier,
    action: input.action,
    latencyMs: input.latencyMs,
    confidence: input.confidence,
    packetId: input.packetId,
    auditAtomId: input.auditAtomId,
    gateReason: input.gateReason,
    contextTokenBudget: input.contextTokenBudget,
  };
}

export async function processAtom(atom: Atom, deps: ProcessAtomDeps): Promise<ProcessAtomResult> {
  const startedAt = nowMs();
  const clock = deps.now ?? (() => new Date());
  assertAtom(atom);

  const gateConfig = deps.gateConfig ?? (await loadGateConfig(deps.neo4j));
  const reflexGate = evaluateReflexGate({
    atom,
    config: gateConfig,
    patternCache: deps.gsapTweenCache,
    fingerprintCache: deps.fingerprintCache,
  });
  if (reflexGate.target === "reflex" && reflexGate.action) {
    return auditedResult({
      atom,
      deps,
      tier: "reflex",
      action: reflexGate.action,
      latencyMs: nowMs() - startedAt,
      confidence: 1,
      gateReason: reflexGate.reason,
      contextTokenBudget: gateConfig.reflexContextTokenBudget,
      timestamp: clock().toISOString(),
    });
  }

  const executive = await runExecutive({
    atom,
    driver: deps.neo4j,
    mellum2: deps.mellum2,
    gateConfig,
    now: clock,
  });

  if (!executive.packet) {
    return auditedResult({
      atom,
      deps,
      tier: "executive",
      action: executive.decision.action,
      latencyMs: nowMs() - startedAt,
      confidence: executive.decision.confidence,
      gateReason: executive.gate.reason,
      contextTokenBudget: gateConfig.executiveContextTokenBudget,
      timestamp: clock().toISOString(),
    });
  }

  const cortex = await runCortex({
    packet: executive.packet,
    mercury2: deps.mercury2,
    auditLogPath: deps.auditLogPath,
    now: clock,
  });

  return auditedResult({
    atom,
    deps,
    tier: "cortex",
    action: cortex.action,
    latencyMs: nowMs() - startedAt,
    confidence: cortex.confidence,
    packetId: executive.packet.packetId,
    auditAtomId: cortex.auditAtomId,
    gateReason: executive.gate.reason,
    contextTokenBudget: gateConfig.cortexContextTokenBudget,
    timestamp: clock().toISOString(),
  });
}

export type { Atom, ProcessAtomDeps, ProcessAtomResult } from "./types.js";
