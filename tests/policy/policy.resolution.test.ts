import { describe, expect, it } from "vitest";
import { PolicyResolutionEngine } from "../../policy/engine/policyResolutionEngine.js";
import { resolvePolicyOutcome } from "../../policy/precedence/policyPrecedence.js";

describe("PolicyResolutionEngine", () => {
  it("evaluates known policies with explicit allow/deny/advisory outcomes", () => {
    const engine = new PolicyResolutionEngine();
    const evaluations = engine.evaluate(["policy-immutability", "policy-lineage-required"], {
      memoryContext: ["atom-1", "atom-2"],
      timelineContext: ["event-1"],
    });

    expect(evaluations).toHaveLength(2);
    expect(evaluations[0].policyId).toBe("policy-immutability");
    expect(evaluations[0].result).toBe("allow");
    expect(evaluations[0].evidence).toContain("atom-1");

    expect(evaluations[1].policyId).toBe("policy-lineage-required");
    expect(evaluations[1].result).toBe("allow");
    expect(evaluations[1].evidence).toContain("event-1");
  });

  it("returns advisory result when policy is not registered", () => {
    const engine = new PolicyResolutionEngine();
    const evaluations = engine.evaluate(["policy-missing"], {
      request: "attempt action",
    });

    expect(evaluations).toHaveLength(1);
    expect(evaluations[0].policyId).toBe("policy-missing");
    expect(evaluations[0].result).toBe("advisory");
    expect(evaluations[0].reason).toContain("not found");
    expect(evaluations[0].evidence).toContain("policy_registry_miss");
  });

  it("applies deterministic precedence when outcomes conflict", () => {
    const denyWins = resolvePolicyOutcome([
      {
        policyId: "policy-a",
        result: "allow",
        reason: "allow reason",
        evidence: ["e1"],
        timestamp: "2026-06-03T00:00:00.000Z",
      },
      {
        policyId: "policy-b",
        result: "deny",
        reason: "deny reason",
        evidence: ["e2"],
        timestamp: "2026-06-03T00:00:00.000Z",
      },
      {
        policyId: "policy-c",
        result: "advisory",
        reason: "advisory reason",
        evidence: ["e3"],
        timestamp: "2026-06-03T00:00:00.000Z",
      },
    ]);
    expect(denyWins).toBe("deny");

    const allowWins = resolvePolicyOutcome([
      {
        policyId: "policy-a",
        result: "allow",
        reason: "allow reason",
        evidence: ["e1"],
        timestamp: "2026-06-03T00:00:00.000Z",
      },
      {
        policyId: "policy-c",
        result: "advisory",
        reason: "advisory reason",
        evidence: ["e3"],
        timestamp: "2026-06-03T00:00:00.000Z",
      },
    ]);
    expect(allowWins).toBe("allow");

    const advisoryOnly = resolvePolicyOutcome([
      {
        policyId: "policy-c",
        result: "advisory",
        reason: "advisory reason",
        evidence: ["e3"],
        timestamp: "2026-06-03T00:00:00.000Z",
      },
    ]);
    expect(advisoryOnly).toBe("advisory");
  });
});
