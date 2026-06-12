import { describe, expect, it } from "vitest";
import { DecisionLineageEngine } from "../../lineage/engine/decisionLineageEngine.js";
import { lineageReplayIsReproducible, replayDecisionLineage } from "../../lineage/replay/lineageReplay.js";

describe("Decision lineage replay", () => {
  it("replays lineage deterministically", () => {
    const engine = new DecisionLineageEngine();
    const lineage = engine.createLineage({
      decisionId: "decision-replay-1",
      memoryAtoms: ["m1"],
      graphNodes: ["g1"],
      policiesApplied: ["p1"],
      timelineEvents: ["t1"],
      executivePlanId: "plan-1",
      timestamp: "2026-06-03T04:00:00.000Z",
    });

    const replayed = replayDecisionLineage(lineage);
    expect(replayed).toEqual(lineage);
    expect(lineageReplayIsReproducible(lineage)).toBe(true);
  });
});
