import { describe, expect, it } from "vitest";
import { computeDecisionHash } from "../../lineage/hashing/decisionHash.js";
import { DecisionReconstructor } from "../../lineage/reconstruction/decisionReconstructor.js";
import { DecisionLineage } from "../../lineage/schemas/decisionLineage.js";
import { DecisionLineageInput } from "../../lineage/schemas/decisionLineage.js";

describe("Decision lineage reconstruction", () => {
  it("reconstructs original decision hash", async () => {
    const lineageInput: DecisionLineageInput = {
      decisionId: "decision-reconstruct-1",
      memoryAtoms: ["m1", "m2"],
      graphNodes: ["g1"],
      policiesApplied: ["p1", "p2"],
      policyEvaluations: [
        {
          policyId: "p1",
          result: "allow",
          reason: "policy p1 allows",
          evidence: ["memory:m1"],
          timestamp: "2026-06-03T05:00:00.000Z",
        },
        {
          policyId: "p2",
          result: "advisory",
          reason: "policy p2 advisory",
          evidence: ["timeline:t1"],
          timestamp: "2026-06-03T05:00:00.000Z",
        },
      ],
      policyResults: ["allow", "advisory"],
      policyEvidence: ["memory:m1", "timeline:t1"],
      finalPolicyOutcome: "allow",
      timelineEvents: ["t1"],
      executivePlanId: "plan-r1",
      timestamp: "2026-06-03T05:00:00.000Z",
    };

    const lineage: DecisionLineage = {
      decisionId: lineageInput.decisionId,
      memoryAtoms: lineageInput.memoryAtoms,
      graphNodes: lineageInput.graphNodes,
      policiesApplied: lineageInput.policiesApplied,
      policyEvaluations: lineageInput.policyEvaluations ?? [],
      policyResults: lineageInput.policyResults ?? [],
      policyEvidence: lineageInput.policyEvidence ?? [],
      finalPolicyOutcome: lineageInput.finalPolicyOutcome ?? "advisory",
      timelineEvents: lineageInput.timelineEvents,
      executivePlanId: lineageInput.executivePlanId,
      timestamp: lineageInput.timestamp ?? "2026-06-03T05:00:00.000Z",
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
    expect(result.policyOutcomeConsistent).toBe(true);
  });

  it("flags inconsistent final policy outcome", async () => {
    const lineageInput: DecisionLineageInput = {
      decisionId: "decision-reconstruct-2",
      memoryAtoms: ["m1"],
      graphNodes: ["g1"],
      policiesApplied: ["p1"],
      policyEvaluations: [
        {
          policyId: "p1",
          result: "deny",
          reason: "policy p1 denies",
          evidence: ["graph:g1"],
          timestamp: "2026-06-03T05:01:00.000Z",
        },
      ],
      policyResults: ["deny"],
      policyEvidence: ["graph:g1"],
      finalPolicyOutcome: "allow",
      timelineEvents: ["t1"],
      executivePlanId: "plan-r2",
      timestamp: "2026-06-03T05:01:00.000Z",
    };

    const lineage: DecisionLineage = {
      decisionId: lineageInput.decisionId,
      memoryAtoms: lineageInput.memoryAtoms,
      graphNodes: lineageInput.graphNodes,
      policiesApplied: lineageInput.policiesApplied,
      policyEvaluations: lineageInput.policyEvaluations ?? [],
      policyResults: lineageInput.policyResults ?? [],
      policyEvidence: lineageInput.policyEvidence ?? [],
      finalPolicyOutcome: lineageInput.finalPolicyOutcome ?? "advisory",
      timelineEvents: lineageInput.timelineEvents,
      executivePlanId: lineageInput.executivePlanId,
      timestamp: lineageInput.timestamp ?? "2026-06-03T05:01:00.000Z",
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
    expect(result.policyOutcomeConsistent).toBe(false);
  });
});
