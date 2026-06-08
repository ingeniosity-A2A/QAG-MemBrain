import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { assertDagPathProvenance, DagPathProvenance } from "../../memory/jsonl/provenance.js";
import { AuditAtom, CortexPacket, Mercury2Client, Mercury2Response, RuntimeAction } from "./types.js";

function assertCompletePacket(packet: CortexPacket): void {
  if (
    !packet.packetId ||
    !packet.atom?.id ||
    !packet.atom?.type ||
    !packet.atom?.source ||
    !packet.atom?.payload ||
    !packet.dagSlice ||
    !Array.isArray(packet.dagSlice.nodes) ||
    !Array.isArray(packet.dagSlice.relationships) ||
    !Array.isArray(packet.policyConflicts) ||
    !packet.executiveDecision ||
    typeof packet.executiveDecision.confidence !== "number" ||
    !packet.gateConfig ||
    !packet.assembledAt
  ) {
    throw new Error("CortexPacket is incomplete");
  }
}

function buildMercuryPrompt(packet: CortexPacket): string {
  return `
AVA007 CORTEX PACKET

Mercury 2 receives only complete packets. Reject all implicit repair, partial context requests, and speculative
policy mutation. The output must be one complete block because Mercury 2 diffusion latency is effectively flat
with respect to this response length; use the available budget to produce a final deterministic decision.

Packet:
${JSON.stringify(packet, null, 2)}

Return a complete action block. If policy change is required, include a successor policy payload only; never mutate
or overwrite prior policy atoms.
`.trim();
}

async function appendAuditAtom(filePath: string, atom: AuditAtom): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(atom)}\n`, { encoding: "utf8", flag: "a" });
}

function extractProvenance(payload: Record<string, unknown>): DagPathProvenance | undefined {
  if (typeof payload.provenance === "undefined") {
    return undefined;
  }

  assertDagPathProvenance(payload.provenance);
  return payload.provenance;
}

export interface CortexResult {
  action: RuntimeAction;
  confidence: number;
  block: string;
  auditAtomId?: string;
}

export async function runCortex(input: {
  packet: CortexPacket;
  mercury2: Mercury2Client;
  auditLogPath: string;
  now: () => Date;
}): Promise<CortexResult> {
  assertCompletePacket(input.packet);

  const response: Mercury2Response = await input.mercury2.generateBlock({
    packet: input.packet,
    prompt: buildMercuryPrompt(input.packet),
  });

  let auditAtomId: string | undefined;
  if (response.policyChange) {
    auditAtomId = `${input.packet.atom.id}:policy-successor:${input.now().getTime()}`;
    await appendAuditAtom(input.auditLogPath, {
      id: auditAtomId,
      type: "policy_change",
      source: "cortex",
      timestamp: input.now().toISOString(),
      predecessorAtomId: input.packet.atom.id,
      packetId: input.packet.packetId,
      payload: response.policyChange,
      provenance: extractProvenance(response.policyChange),
    });
  }

  return {
    action: response.action,
    confidence: response.confidence,
    block: response.block,
    auditAtomId,
  };
}
