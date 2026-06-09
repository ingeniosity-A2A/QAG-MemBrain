import { AtomicMemory, AVA007Decision } from "../shared/types.js";

export interface Mercury2Request {
  packet: {
    intent: string;
    fullContext: AtomicMemory[];
    userOverrides?: string[];
    signalMetadata: Record<string, unknown>;
  };
}

export interface Mercury2Response {
  policyDelta: Partial<AtomicMemory>;
  newDecision: AVA007Decision;
  auditAtom: AtomicMemory;
}

export class Mercury2Client {
  async deepReason(request: Mercury2Request): Promise<Mercury2Response> {
    if (!request.packet.intent || !request.packet.fullContext.length) {
      throw new Error("INCOMPLETE_PACKET: intent and fullContext required");
    }

    const auditAtom: AtomicMemory = {
      id: `audit_${Date.now()}`,
      type: "memory",
      source: "system",
      timestamp: new Date().toISOString(),
      title: "Cortex decision audit",
      content: `Cortex evaluated intent ${request.packet.intent}`,
      tags: ["audit", "cortex"],
      embedding: null,
      metadata: {
        confidence: 0.88,
        importance: "high",
        riskLevel: "low",
      },
    };

    const newDecision: AVA007Decision = {
      action: "policy_generated",
      params: { generatedFrom: request.packet.intent },
      escalate: false,
      confidence: 0.88,
      reason: "Cortex deep reasoning completed",
    };

    return {
      policyDelta: { metadata: { confidence: 0.88, importance: "high", riskLevel: "low" } as any },
      newDecision,
      auditAtom,
    };
  }
}
