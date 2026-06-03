import { describe, expect, it } from "vitest";
import { computeDecisionHash } from "../../lineage/hashing/decisionHash.js";

describe("Decision lineage hashing", () => {
  it("produces a stable hash for the same lineage input", () => {
    const input = {
      decisionId: "decision-hash-1",
      memoryAtoms: ["m1", "m2"],
      graphNodes: ["g1", "g2"],
      policiesApplied: ["p1"],
      timelineEvents: ["t1", "t2"],
      executivePlanId: "plan-1",
    };

    const hashA = computeDecisionHash(input);
    const hashB = computeDecisionHash(input);

    expect(hashA).toBe(hashB);
  });

  it("changes hash when lineage references change", () => {
    const base = {
      decisionId: "decision-hash-2",
      memoryAtoms: ["m1"],
      graphNodes: ["g1"],
      policiesApplied: ["p1"],
      timelineEvents: ["t1"],
      executivePlanId: "plan-1",
    };

    const changed = {
      ...base,
      graphNodes: ["g1", "g2"],
    };

    expect(computeDecisionHash(base)).not.toBe(computeDecisionHash(changed));
  });
});
