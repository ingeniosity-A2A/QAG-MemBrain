import { describe, expect, it } from "vitest";
import { DecisionLineageEngine } from "../../lineage/engine/decisionLineageEngine.js";

describe("Decision lineage policy integration", () => {
  it("captures policy evaluations, results, and evidence in lineage", () => {
    const engine = new DecisionLineageEngine();

    const lineage = engine.createLineage({
      decisionId: "decision-policy-1",
      memoryAtoms: ["mem-a"],
      graphNodes: ["node-a"],
      policiesApplied: ["policy-immutability"],
      policyEvaluations: [
        {
          policyId: "policy-immutability",
          result: "allow",
          reason: "memory atom is immutable",
          evidence: ["mem-a", "ledger-proof"],
          timestamp: "2026-01-01T00:00:00.000Z",
        },
      ],
      timelineEvents: ["timeline-1"],
      executivePlanId: "plan-policy-1",
      timestamp: "2026-01-01T00:00:00.000Z",
    });

    expect(lineage.policyEvaluations).toHaveLength(1);
    expect(lineage.policyEvaluations[0].policyId).toBe("policy-immutability");
    expect(lineage.policyResults).toEqual(["allow"]);
    expect(lineage.policyEvidence).toEqual(["mem-a", "ledger-proof"]);
    expect(lineage.finalPolicyOutcome).toBe("allow");
    expect(engine.verifyLineage(lineage)).toBe(true);
  });
});
