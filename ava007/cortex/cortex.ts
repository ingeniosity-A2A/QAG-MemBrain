import { BrainResult, CortexPacket } from "../shared/types.js";

const MERCURY2_ENDPOINT = process.env.MERCURY2_ENDPOINT ?? "https://api.inceptionlabs.ai/v1/chat/completions";
const MERCURY2_API_KEY = process.env.MERCURY2_API_KEY ?? "";
const MERCURY2_MODEL = "mercury-coder-small";

interface Mercury2Response {
  id: string;
  choices: Array<{
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage: { prompt_tokens: number; completion_tokens: number };
}

function buildCortexPrompt(packet: CortexPacket): string {
  const dagContext = packet.dag_slice
    .map(
      (atom, index) =>
        `[${index + 1}] type=${atom.type} importance=${atom.metadata.importance} ` +
        `confidence=${atom.metadata.confidence}\n    content: ${atom.content}`,
    )
    .join("\n");

  return `You are the cortex of the AVA007 cognitive system.
The executive brain (Mellum2) escalated this atom because it could not resolve it.

ESCALATION REASON: ${packet.escalation_reason}
EXECUTIVE INTENT: ${packet.intent}

CURRENT POLICY CONTEXT:
${packet.policy_context}

ATOM REQUIRING DEEP REASONING:
  id: ${packet.atom.id}
  type: ${packet.atom.type}
  importance: ${packet.atom.metadata.importance}
  confidence score at ingestion: ${packet.atom.metadata.confidence}
  content: ${packet.atom.content}
  tags: ${packet.atom.tags.join(", ")}

ANCESTOR DAG SLICE (${packet.dag_slice.length} atoms):
${dagContext || "  none - this is a novel atom with no prior context"}

YOUR RESPONSIBILITIES:
1. Decide the correct action for this atom
2. If the atom type is novel (no DAG match), define a new routing rule
3. If a policy conflict exists, resolve it and state which policy wins and why
4. Output a policy update if routing behavior should change going forward
5. Be verbose - latency is flat on Mercury 2, thoroughness is free

Respond ONLY with valid JSON, no markdown:
{
  "action": "<specific_action_string>",
  "confidence": <float 0.0-1.0>,
  "reasoning": "<detailed explanation>",
  "policy_update": {
    "required": <boolean>,
    "change": "<description of what should change, or null>",
    "new_known_type": "<type string to add to reflex known set, or null>"
  }
}`;
}

async function callMercury2(prompt: string): Promise<{
  action: string;
  confidence: number;
  reasoning: string;
  policy_update: {
    required: boolean;
    change: string | null;
    new_known_type: string | null;
  };
}> {
  const resp = await fetch(MERCURY2_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${MERCURY2_API_KEY}`,
    },
    body: JSON.stringify({
      model: MERCURY2_MODEL,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1024,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Mercury 2 call failed ${resp.status}: ${err}`);
  }

  const data = (await resp.json()) as Mercury2Response;
  const raw = data.choices[0]?.message?.content;

  if (!raw) {
    throw new Error("Mercury 2 returned empty content");
  }

  try {
    return JSON.parse(raw) as {
      action: string;
      confidence: number;
      reasoning: string;
      policy_update: {
        required: boolean;
        change: string | null;
        new_known_type: string | null;
      };
    };
  } catch {
    throw new Error(`Mercury 2 returned non-JSON: ${raw.slice(0, 200)}`);
  }
}

async function writePolicyUpdate(
  packet: CortexPacket,
  cortexOutput: Awaited<ReturnType<typeof callMercury2>>,
  auditLogger: (record: Record<string, unknown>) => Promise<void>,
): Promise<void> {
  if (!cortexOutput.policy_update.required) {
    return;
  }

  await auditLogger({
    type: "policy_update",
    source: "cortex",
    title: "Cortex policy update",
    content: cortexOutput.policy_update.change,
    metadata: {
      importance: "high",
      confidence: cortexOutput.confidence,
      triggered_by_atom: packet.atom.id,
      new_known_type: cortexOutput.policy_update.new_known_type,
    },
    timestamp: Date.now(),
  });
}

export async function runCortex(
  packet: CortexPacket,
  auditLogger: (record: Record<string, unknown>) => Promise<void>,
): Promise<BrainResult> {
  const start = Date.now();

  if (!packet.atom || !packet.escalation_reason || !packet.policy_context) {
    throw new Error(
      "Cortex received an incomplete packet. " +
        "Executive must assemble full context before escalating. " +
        `Missing: ${[
          !packet.atom && "atom",
          !packet.escalation_reason && "escalation_reason",
          !packet.policy_context && "policy_context",
        ]
          .filter(Boolean)
          .join(", ")}`,
    );
  }

  const prompt = buildCortexPrompt(packet);
  const cortexOutput = await callMercury2(prompt);
  const latency_ms = Date.now() - start;

  await writePolicyUpdate(packet, cortexOutput, auditLogger);

  return {
    tier: "cortex",
    atom_id: packet.atom.id,
    action: cortexOutput.action,
    output: {
      reasoning: cortexOutput.reasoning,
      policy_update_required: cortexOutput.policy_update.required,
      new_known_type: cortexOutput.policy_update.new_known_type,
      dag_slice_depth: packet.dag_slice.length,
    },
    confidence: cortexOutput.confidence,
    model_used: MERCURY2_MODEL,
    latency_ms,
    escalate: false,
  };
}
