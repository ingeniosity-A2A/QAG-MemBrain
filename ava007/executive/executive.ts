import { BrainResult, CortexPacket, MemoryAtom } from "../shared/types.js";
import { DEFAULT_GATE_CONFIG, GateConfig } from "../shared/gate_config.js";

const MELLUM2_ENDPOINT = process.env.MELLUM2_ENDPOINT ?? "http://localhost:11434/api/generate";
const MELLUM2_MODEL = "mellum2";

async function fetchDagSlice(atom: MemoryAtom, depth: number, neo4jDriver: unknown): Promise<MemoryAtom[]> {
  const driver = neo4jDriver as {
    session: () => {
      run: (query: string, params: Record<string, unknown>) => Promise<{ records: Array<{ get: (key: string) => unknown }> }>;
      close: () => Promise<void>;
    };
  };
  const session = driver.session();
  try {
    const result = await session.run(
      `
      MATCH path = (root:Memory {id: $id})-[:PRECEDES*1..5]->(ancestor:Memory)
      WHERE length(path) <= $depth
      WITH ancestor
      ORDER BY ancestor.timestamp DESC
      LIMIT 20
      RETURN ancestor
      `,
      { id: atom.id, depth },
    );
    return result.records.map((record) => {
      const node = record.get("ancestor") as { properties: MemoryAtom };
      return node.properties;
    });
  } finally {
    await session.close();
  }
}

async function detectPolicyConflict(atom: MemoryAtom, neo4jDriver: unknown): Promise<boolean> {
  const driver = neo4jDriver as {
    session: () => {
      run: (query: string, params: Record<string, unknown>) => Promise<{ records: Array<{ get: (key: string) => unknown }> }>;
      close: () => Promise<void>;
    };
  };
  const session = driver.session();
  try {
    const result = await session.run(
      `
      MATCH (m:Memory {id: $id})<-[:INFLUENCED]-(p:Policy)
      WHERE p.type = 'routing' AND p.action <> $expected_action
      RETURN count(p) AS conflicts
      `,
      { id: atom.id, expected_action: atom.type },
    );
    const value = result.records[0]?.get("conflicts");
    const conflicts =
      typeof value === "object" && value !== null && "toNumber" in value
        ? (value as { toNumber: () => number }).toNumber()
        : Number(value ?? 0);
    return conflicts > 0;
  } finally {
    await session.close();
  }
}

async function callMellum2(
  atom: MemoryAtom,
  dagSlice: MemoryAtom[],
  policy: string,
): Promise<{ action: string; confidence: number; reasoning: string }> {
  const prompt = buildExecutivePrompt(atom, dagSlice, policy);
  const resp = await fetch(MELLUM2_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MELLUM2_MODEL,
      prompt,
      stream: false,
      format: "json",
    }),
  });

  if (!resp.ok) {
    throw new Error(`Mellum2 call failed: ${resp.status}`);
  }

  const data = (await resp.json()) as { response?: string };
  if (!data.response) {
    throw new Error("Mellum2 returned empty response");
  }

  try {
    return JSON.parse(data.response) as { action: string; confidence: number; reasoning: string };
  } catch {
    throw new Error(`Mellum2 returned non-JSON: ${data.response}`);
  }
}

function buildExecutivePrompt(atom: MemoryAtom, dagSlice: MemoryAtom[], policy: string): string {
  const dagSummary = dagSlice
    .slice(0, 5)
    .map((entry) => `- [${entry.type}] ${entry.title} (confidence: ${entry.metadata.confidence})`)
    .join("\n");

  return `You are the executive brain of the AVA007 cognitive system.
Your job: decide what action to take for this input atom, or declare you cannot and escalate.

CURRENT ROUTING POLICY:
${policy}

INCOMING ATOM:
type: ${atom.type}
importance: ${atom.metadata.importance}
confidence: ${atom.metadata.confidence}
content: ${atom.content}

RECENT DAG CONTEXT (ancestor atoms):
${dagSummary || "none"}

Respond ONLY with valid JSON, no markdown:
{
  "action": "<specific_action_string>",
  "confidence": <float 0.0-1.0>,
  "reasoning": "<one sentence>"
}

If you cannot resolve this with confidence >= 0.60, set action to "escalate_to_cortex".`;
}

function shouldEscalateToCortex(
  atom: MemoryAtom,
  mellumResult: { action: string; confidence: number },
  hasConflict: boolean,
  config: GateConfig,
): { escalate: boolean; reason?: string } {
  if (atom.metadata.importance === "critical") {
    return { escalate: true, reason: "importance is critical - always escalates" };
  }
  if (hasConflict) {
    return { escalate: true, reason: "policy conflict detected in DAG" };
  }
  if (mellumResult.confidence < config.executive_pass_confidence) {
    return {
      escalate: true,
      reason: `confidence ${mellumResult.confidence} below threshold ${config.executive_pass_confidence}`,
    };
  }
  if (mellumResult.action === "escalate_to_cortex") {
    return { escalate: true, reason: "executive self-reported inability to resolve" };
  }
  return { escalate: false };
}

export async function runExecutive(
  atom: MemoryAtom,
  neo4jDriver: unknown,
  config: GateConfig = DEFAULT_GATE_CONFIG,
  currentPolicy = "default: route by type and confidence",
): Promise<{ result: BrainResult; cortexPacket?: CortexPacket }> {
  const start = Date.now();
  const dagSlice = await fetchDagSlice(atom, config.executive_max_dag_depth, neo4jDriver);
  const hasConflict = await detectPolicyConflict(atom, neo4jDriver);
  const mellumResult = await callMellum2(atom, dagSlice, currentPolicy);
  const { escalate, reason } = shouldEscalateToCortex(atom, mellumResult, hasConflict, config);
  const latency_ms = Date.now() - start;

  const result: BrainResult = {
    tier: "executive",
    atom_id: atom.id,
    action: escalate ? "escalate_to_cortex" : mellumResult.action,
    output: { reasoning: mellumResult.reasoning, dag_depth: dagSlice.length },
    confidence: mellumResult.confidence,
    model_used: MELLUM2_MODEL,
    latency_ms,
    escalate,
    escalation_reason: reason,
  };

  const cortexPacket: CortexPacket | undefined = escalate
    ? {
        atom,
        dag_slice: dagSlice,
        policy_context: currentPolicy,
        intent: mellumResult.reasoning,
        escalation_reason: reason ?? "unknown",
      }
    : undefined;

  return { result, cortexPacket };
}
