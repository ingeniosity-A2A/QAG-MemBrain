import { describe, expect, it } from "vitest";
import { SpatialCortex } from "../../cortex/spatial/spatialCortex.js";
import { ReconstructionQueryEngine } from "../../cortex/spatial/reconstructionQueryEngine.js";
import { buildMemoryChallenges } from "../../evaluation/memoryJudge/challenger.js";
import { judgeMemorySolvers } from "../../evaluation/memoryJudge/judge.js";
import { runSpatialSolver } from "../../evaluation/memoryJudge/spatialSolver.js";
import { runStrongSolver } from "../../evaluation/memoryJudge/strongSolver.js";
import { runWeakSolver } from "../../evaluation/memoryJudge/weakSolver.js";

describe("Memory Judge", () => {
  it("accepts strong solver when it outperforms weak solver by 20 percent", () => {
    const spatial = new SpatialCortex();
    spatial.upsertAtom({
      atomId: "quote-812",
      type: "Quote",
      relationships: ["customer-44", "decision-91"],
      timestamp: "2026-06-03T00:00:00.000Z",
      authorityRoot: "root-1",
    });
    spatial.upsertAtom({ atomId: "decision-91", type: "Decision", relationships: [], timestamp: "2026-06-03T00:00:01.000Z", authorityRoot: "root-1" });
    spatial.upsertAtom({ atomId: "approval-policy:v4", type: "Policy", relationships: [], timestamp: "2026-06-03T00:00:01.000Z", authorityRoot: "root-1" });
    spatial.upsertAtom({ atomId: "governance-rule:12", type: "GovernanceRule", relationships: [], timestamp: "2026-06-03T00:00:01.000Z", authorityRoot: "root-1" });
    spatial.upsertAtom({ atomId: "deployment-version:1.0.0", type: "Deployment", relationships: [], timestamp: "2026-06-03T00:00:01.000Z", authorityRoot: "root-1" });
    spatial.upsertAtom({ atomId: "authority-signature:sig-1", type: "AuthoritySignature", relationships: [], timestamp: "2026-06-03T00:00:01.000Z", authorityRoot: "root-1" });
    spatial.addRelationship({ fromAtomId: "decision-91", toAtomId: "quote-812", relation: "approved", timestamp: "2026-06-03T00:00:01.000Z" });
    spatial.addRelationship({ fromAtomId: "decision-91", toAtomId: "approval-policy:v4", relation: "influenced_by", timestamp: "2026-06-03T00:00:01.000Z" });
    spatial.addRelationship({ fromAtomId: "approval-policy:v4", toAtomId: "governance-rule:12", relation: "originated_from", timestamp: "2026-06-03T00:00:01.000Z" });
    spatial.addRelationship({ fromAtomId: "governance-rule:12", toAtomId: "deployment-version:1.0.0", relation: "modified_by", timestamp: "2026-06-03T00:00:01.000Z" });
    spatial.addRelationship({ fromAtomId: "deployment-version:1.0.0", toAtomId: "authority-signature:sig-1", relation: "verified_by", timestamp: "2026-06-03T00:00:01.000Z" });
    spatial.addRelationship({ fromAtomId: "lineage-91", toAtomId: "decision-91", relation: "lineage_of", timestamp: "2026-06-03T00:00:01.000Z" });

    const challenges = buildMemoryChallenges(["quote-812"]);
    const weak = runWeakSolver(challenges);
    const queryEngine = new ReconstructionQueryEngine(spatial);
    const replaySpatial = runSpatialSolver(queryEngine, challenges);
    const strong = runStrongSolver(queryEngine, challenges);

    const result = judgeMemorySolvers(challenges, weak, strong, replaySpatial);
    expect(result.accepted).toBe(true);
    expect(result.improvementPercent.accuracy).toBeGreaterThanOrEqual(20);
    expect(result.improvementPercent.authorityCorrectness).toBeGreaterThanOrEqual(20);
    expect(result.improvementPercent.provenanceDepth).toBeGreaterThanOrEqual(20);
    expect(result.improvementPercent.lineageCompleteness).toBeGreaterThanOrEqual(20);
    expect(result.improvementPercent.relationshipAccuracy).toBeGreaterThanOrEqual(20);
    expect(result.replaySpatial?.averageScore ?? 0).toBeGreaterThan(result.weak.averageScore);
  });
});
