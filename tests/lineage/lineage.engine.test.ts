import { describe, expect, it } from "vitest";
import { DecisionLineageEngine } from "../../lineage/engine/decisionLineageEngine.js";

describe("Decision lineage engine", () => {
  it("creates lineage only when references exist", () => {
    const engine = new DecisionLineageEngine();

    const lineage = engine.createLineage(
      {
        decisionId: "decision-engine-1",
        memoryAtoms: ["mem-1"],
        graphNodes: ["node-1"],
        policiesApplied: ["policy-1"],
        timelineEvents: ["evt-1"],
        executivePlanId: "plan-1",
      },
      {
        existingMemoryAtoms: new Set(["mem-1"]),
        existingGraphNodes: new Set(["node-1"]),
        existingPolicies: new Set(["policy-1"]),
        existingTimelineEvents: new Set(["evt-1"]),
      },
    );

    expect(lineage.decisionId).toBe("decision-engine-1");
    expect(lineage.memoryAtoms).toEqual(["mem-1"]);
    expect(lineage.finalPolicyOutcome).toBe("advisory");
    expect(engine.verifyLineage(lineage)).toBe(true);
  });

  it("rejects missing references", () => {
    const engine = new DecisionLineageEngine();

    expect(() =>
      engine.createLineage(
        {
          decisionId: "decision-engine-2",
          memoryAtoms: ["missing-memory"],
          graphNodes: ["node-1"],
          policiesApplied: ["policy-1"],
          timelineEvents: ["evt-1"],
          executivePlanId: "plan-2",
        },
        {
          existingMemoryAtoms: new Set(["mem-1"]),
          existingGraphNodes: new Set(["node-1"]),
          existingPolicies: new Set(["policy-1"]),
          existingTimelineEvents: new Set(["evt-1"]),
        },
      ),
    ).toThrow(/memoryAtoms reference does not exist/);
  });
});
