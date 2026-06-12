import { randomUUID } from "node:crypto";
import { assertCanDecide } from "../contract/enforcement.js";
import { JSONLMemoryStore, createAtomicMemory } from "../memory/jsonl/atomic_memory.js";
import { AvaDecision, ObservationProposal } from "../shared/types.js";

export class Ava007 {
  constructor(private readonly memory: JSONLMemoryStore) {}

  async evaluate(proposal: ObservationProposal): Promise<AvaDecision> {
    assertCanDecide("L6");
    const accepted = proposal.confidence >= 0.6;
    const decision: AvaDecision = {
      id: randomUUID(),
      decided_by: "Ava007",
      accepted,
      reason: accepted ? "confidence threshold met" : "confidence threshold not met",
      proposal_id: proposal.id,
    };

    if (accepted) {
      const memory = proposal.proposed_memory ?? createAtomicMemory({
        type: "memory",
        source: "ava007",
        content: proposal.intent,
        metadata: { proposal_id: proposal.id },
        layer: "L6",
      });
      const committed = await this.memory.append(memory, "L6");
      decision.committed_memory_id = committed.id;
    }

    return decision;
  }
}
