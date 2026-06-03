import { describe, expect, it } from "vitest";
import { computeDecisionHash } from "../../lineage/hashing/decisionHash.js";
import { DecisionReconstructor } from "../../lineage/reconstruction/decisionReconstructor.js";
import { DecisionLineage } from "../../lineage/schemas/decisionLineage.js";

describe("Decision lineage reconstruction", () => {
  it("reconstructs original decision hash", async () => {
    const lineageInput = {
      decisionId: "decision-reconstruct-1",
      memoryAtoms: ["m1", "m2"],
      graphNodes: ["g1"],
      policiesApplied: ["p1", "p2"],
      timelineEvents: ["t1"],
      executivePlanId: "plan-r1",
      timestamp: "2026-06-03T05:00:00.000Z",
    };

    const lineage: DecisionLineage = {
      ...lineageInput,
      decisionHash: computeDecisionHash(lineageInput),
    };

    const reconstructor = new DecisionReconstructor();

    const result = await reconstructor.reconstruct(lineage.decisionId, {
      loadLineage: async (decisionId) => (decisionId === lineage.decisionId ? lineage : null),
      loadMemoryAtom: async (id) => (lineage.memoryAtoms.includes(id) ? { id } : null),
      loadGraphNode: async (id) => (lineage.graphNodes.includes(id) ? { id } : null),
      loadPolicy: async (id) => (lineage.policiesApplied.includes(id) ? { id } : null),
      loadTimelineEvent: async (id) => (lineage.timelineEvents.includes(id) ? { id } : null),
    });

    expect(result.hashMatch).toBe(true);
    expect(result.originalHash).toBe(result.reconstructedHash);
    expect(result.memoryLoaded).toBe(2);
    expect(result.graphLoaded).toBe(1);
    expect(result.policiesLoaded).toBe(2);
    expect(result.timelineLoaded).toBe(1);
  });
});
