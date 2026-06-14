import { describe, expect, it } from "vitest";
import { DecisionRecord } from "../../audit/decisions/decisionRecord.js";
import { AUTHORITY_REPLAY_FAILURES } from "../../authority/execution/authorityReplayResult.js";
import { AuthorityReplayEngine } from "../../authority/execution/authorityReplayEngine.js";
import { computeDecisionHash } from "../../lineage/hashing/decisionHash.js";
import { DecisionLineage } from "../../lineage/schemas/decisionLineage.js";
import { DecisionLineageInput } from "../../lineage/schemas/decisionLineage.js";

function buildLineage(): DecisionLineage {
  const input: DecisionLineageInput = {
    decisionId: "dec-hash-1",
    memoryAtoms: ["mem-1"],
    graphNodes: ["graph-1"],
    policiesApplied: ["policy-1"],
    policyEvaluations: [
      {
        policyId: "policy-1",
        result: "allow" as const,
        reason: "policy allows",
        evidence: ["mem-1"],
        timestamp: "2026-06-03T08:01:00.000Z",
      },
    ],
    policyResults: ["allow"],
    policyEvidence: ["mem-1"],
    finalPolicyOutcome: "allow" as const,
    timelineEvents: ["time-1"],
    executivePlanId: "plan-1",
    timestamp: "2026-06-03T08:01:00.000Z",
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
    timestamp: input.timestamp ?? "2026-06-03T08:01:00.000Z",
    decisionHash: computeDecisionHash(input),
  };
}

describe("Authority replay hash failure", () => {
  it("returns FAILED and HASH_MISMATCH", async () => {
    const lineage = buildLineage();
    const decision: DecisionRecord = {
      decisionId: lineage.decisionId,
      memories: [...lineage.memoryAtoms],
      policies: [...lineage.policiesApplied],
      relationships: [...lineage.graphNodes],
      timestamp: lineage.timestamp,
      executionPath: ["reflex", "executive"],
      lineageId: lineage.decisionId,
      decisionHash: "incorrect-hash",
    };

    const engine = new AuthorityReplayEngine({
      loadDecision: async () => decision,
      loadLineage: async () => lineage,
      loadMemoryReference: async (id) => ({ id }),
      loadGraphReference: async (id) => ({ id }),
      loadTimelineReference: async (id) => ({ id }),
      loadPolicyReference: async (id) => ({ id }),
    });

    const result = await engine.execute(decision.decisionId);

    expect(result.status).toBe("FAILED");
    expect(result.hashMatch).toBe(false);
    expect(result.failures).toContain(AUTHORITY_REPLAY_FAILURES.HASH_MISMATCH);
  });
});