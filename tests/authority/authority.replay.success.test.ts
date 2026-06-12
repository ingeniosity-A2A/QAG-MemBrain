import { describe, expect, it } from "vitest";
import { DecisionRecord } from "../../audit/decisions/decisionRecord.js";
import { AuthorityReplayEngine } from "../../authority/execution/authorityReplayEngine.js";
import { AuthorityReplayRunner } from "../../authority/execution/authorityReplayRunner.js";
import { computeDecisionHash } from "../../lineage/hashing/decisionHash.js";
import { DecisionLineage } from "../../lineage/schemas/decisionLineage.js";
import { DecisionLineageInput } from "../../lineage/schemas/decisionLineage.js";

function buildLineage(): DecisionLineage {
  const input: DecisionLineageInput = {
    decisionId: "dec-001",
    memoryAtoms: ["mem-1"],
    graphNodes: ["graph-1"],
    policiesApplied: ["policy-1"],
    policyEvaluations: [
      {
        policyId: "policy-1",
        result: "allow" as const,
        reason: "policy allows",
        evidence: ["mem-1"],
        timestamp: "2026-06-03T08:00:00.000Z",
      },
    ],
    policyResults: ["allow"],
    policyEvidence: ["mem-1"],
    finalPolicyOutcome: "allow" as const,
    timelineEvents: ["time-1"],
    executivePlanId: "plan-1",
    timestamp: "2026-06-03T08:00:00.000Z",
  };

  return {
    decisionId: input.decisionId,
    memoryAtoms: input.memoryAtoms,
    graphNodes: input.graphNodes,
    policiesApplied: input.policiesApplied,
    policyEvaluations: input.policyEvaluations ?? [],
    policyResults: input.policyResults ?? [],
    policyEvidence: input.policyEvidence ?? [],
    finalPolicyOutcome: input.finalPolicyOutcome ?? "advisory",
    timelineEvents: input.timelineEvents,
    executivePlanId: input.executivePlanId,
    timestamp: input.timestamp ?? "2026-06-03T08:00:00.000Z",
    decisionHash: computeDecisionHash(input),
  };
}

function buildDecision(lineage: DecisionLineage): DecisionRecord {
  return {
    decisionId: lineage.decisionId,
    memories: [...lineage.memoryAtoms],
    policies: [...lineage.policiesApplied],
    relationships: [...lineage.graphNodes],
    timestamp: lineage.timestamp,
    executionPath: ["reflex", "executive"],
    lineageId: lineage.decisionId,
    decisionHash: lineage.decisionHash,
  };
}

describe("Authority replay success", () => {
  it("returns VERIFIED when replay reconstruction and invariants pass", async () => {
    const lineage = buildLineage();
    const decision = buildDecision(lineage);

    const engine = new AuthorityReplayEngine({
      loadDecision: async (decisionId) => (decisionId === decision.decisionId ? decision : null),
      loadLineage: async (lineageId) => (lineageId === lineage.decisionId ? lineage : null),
      loadMemoryReference: async (id) => (id === "mem-1" ? { id } : null),
      loadGraphReference: async (id) => (id === "graph-1" ? { id } : null),
      loadTimelineReference: async (id) => (id === "time-1" ? { id } : null),
      loadPolicyReference: async (id) => (id === "policy-1" ? { id } : null),
    });

    const runner = new AuthorityReplayRunner(engine);
    const result = await runner.run(decision.decisionId);

    expect(result.status).toBe("VERIFIED");
    expect(result.hashMatch).toBe(true);
    expect(result.policyMatch).toBe(true);
    expect(result.referencesValid).toBe(true);
    expect(result.reconstructionMatch).toBe(true);
    expect(result.failures).toEqual([]);
  });
});