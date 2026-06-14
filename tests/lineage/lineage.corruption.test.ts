import { describe, expect, it } from "vitest";
import { computeDecisionHash } from "../../lineage/hashing/decisionHash.js";
import { DecisionReconstructor } from "../../lineage/reconstruction/decisionReconstructor.js";
import { DecisionLineage } from "../../lineage/schemas/decisionLineage.js";
import { DecisionLineageInput } from "../../lineage/schemas/decisionLineage.js";

describe("Decision lineage corruption detection", () => {
  it("detects modified lineage references", async () => {
    const originalInput: DecisionLineageInput = {
      decisionId: "decision-corrupt-1",
      memoryAtoms: ["m1", "m2"],
      graphNodes: ["g1"],
      policiesApplied: ["p1"],
      policyEvaluations: [
        {
          policyId: "p1",
          result: "allow",
          reason: "policy p1 allows",
          evidence: ["memory:m1"],
          timestamp: "2026-06-03T05:10:00.000Z",
        },
      ],
      policyResults: ["allow"],
      policyEvidence: ["memory:m1"],
      finalPolicyOutcome: "allow",
      timelineEvents: ["t1"],
      executivePlanId: "plan-c1",
      timestamp: "2026-06-03T05:10:00.000Z",
    };

    const tamperedLineage: DecisionLineage = {
      decisionId: originalInput.decisionId,
      memoryAtoms: ["m1", "mX"],
      graphNodes: originalInput.graphNodes,
      policiesApplied: originalInput.policiesApplied,
      policyEvaluations: originalInput.policyEvaluations ?? [],
      policyResults: originalInput.policyResults ?? [],
      policyEvidence: originalInput.policyEvidence ?? [],
      finalPolicyOutcome: originalInput.finalPolicyOutcome ?? "advisory",
      timelineEvents: originalInput.timelineEvents,
      executivePlanId: originalInput.executivePlanId,
      timestamp: originalInput.timestamp ?? "2026-06-03T05:10:00.000Z",
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
    expect(result.policyOutcomeConsistent).toBe(true);
  });
});
