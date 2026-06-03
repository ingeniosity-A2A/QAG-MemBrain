import { describe, expect, it } from "vitest";
import { computeDecisionHash } from "../../lineage/hashing/decisionHash.js";
import { DecisionReconstructor } from "../../lineage/reconstruction/decisionReconstructor.js";
import { DecisionLineage } from "../../lineage/schemas/decisionLineage.js";

describe("Decision lineage corruption detection", () => {
  it("detects modified lineage references", async () => {
    const originalInput = {
      decisionId: "decision-corrupt-1",
      memoryAtoms: ["m1", "m2"],
      graphNodes: ["g1"],
      policiesApplied: ["p1"],
      timelineEvents: ["t1"],
      executivePlanId: "plan-c1",
      timestamp: "2026-06-03T05:10:00.000Z",
    };

    const tamperedLineage: DecisionLineage = {
      ...originalInput,
      memoryAtoms: ["m1", "mX"],
      decisionHash: computeDecisionHash(originalInput),
    };

    const reconstructor = new DecisionReconstructor();
    const result = await reconstructor.reconstruct(tamperedLineage.decisionId, {
      loadLineage: async (decisionId) => (decisionId === tamperedLineage.decisionId ? tamperedLineage : null),
      loadMemoryAtom: async (id) => (["m1", "m2"].includes(id) ? { id } : null),
      loadGraphNode: async (id) => (tamperedLineage.graphNodes.includes(id) ? { id } : null),
      loadPolicy: async (id) => (tamperedLineage.policiesApplied.includes(id) ? { id } : null),
      loadTimelineEvent: async (id) => (tamperedLineage.timelineEvents.includes(id) ? { id } : null),
    });

    expect(result.hashMatch).toBe(false);
    expect(result.originalHash).not.toBe(result.reconstructedHash);
    expect(result.memoryLoaded).toBe(1);
  });
});
