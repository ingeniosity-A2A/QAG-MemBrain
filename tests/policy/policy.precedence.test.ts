import { describe, expect, it } from "vitest";
import { resolvePolicyOutcome } from "../../policy/precedence/policyPrecedence.js";

describe("Policy precedence resolution", () => {
  it("deny wins over allow and advisory", () => {
    const outcome = resolvePolicyOutcome([
      {
        policyId: "policy-a",
        result: "allow",
        reason: "allow",
        evidence: ["e1"],
        timestamp: "2026-06-03T00:00:00.000Z",
      },
      {
        policyId: "policy-b",
        result: "deny",
        reason: "deny",
        evidence: ["e2"],
        timestamp: "2026-06-03T00:00:00.000Z",
      },
      {
        policyId: "policy-c",
        result: "advisory",
        reason: "advisory",
        evidence: ["e3"],
        timestamp: "2026-06-03T00:00:00.000Z",
      },
    ]);

    expect(outcome).toBe("deny");
  });

  it("allow wins over advisory", () => {
    const outcome = resolvePolicyOutcome([
      {
        policyId: "policy-a",
        result: "allow",
        reason: "allow",
        evidence: ["e1"],
        timestamp: "2026-06-03T00:00:00.000Z",
      },
      {
        policyId: "policy-c",
        result: "advisory",
        reason: "advisory",
        evidence: ["e3"],
        timestamp: "2026-06-03T00:00:00.000Z",
      },
    ]);

    expect(outcome).toBe("allow");
  });

  it("advisory is returned when only advisory exists", () => {
    const outcome = resolvePolicyOutcome([
      {
        policyId: "policy-c",
        result: "advisory",
        reason: "advisory",
        evidence: ["e3"],
        timestamp: "2026-06-03T00:00:00.000Z",
      },
    ]);

    expect(outcome).toBe("advisory");
  });
});
