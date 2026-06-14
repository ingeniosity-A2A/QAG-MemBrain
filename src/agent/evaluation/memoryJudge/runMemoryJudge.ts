import { join } from "node:path";
import { writeJson } from "../shared/jsonl.js";
import { SpatialCortex } from "../../cortex/spatial/spatialCortex.js";
import { ReconstructionQueryEngine } from "../../cortex/spatial/reconstructionQueryEngine.js";
import { buildMemoryChallenges } from "./challenger.js";
import { judgeMemorySolvers } from "./judge.js";
import { runSpatialSolver } from "./spatialSolver.js";
import { runStrongSolver } from "./strongSolver.js";
import { runWeakSolver } from "./weakSolver.js";

export async function runMemoryJudge(outputPath = join(process.cwd(), "evaluation", "memory-judge-report.json")) {
  const spatial = new SpatialCortex();
  spatial.upsertRoom({ roomId: "customer-wing", name: "Customer Wing", description: "Customer support and quoting operations" });
  spatial.upsertRoom({ roomId: "authority-wing", name: "Authority Wing", description: "Governance, build, deployment, runtime" });
  spatial.upsertZone({ zoneId: "quotes", roomId: "customer-wing", name: "Quotes", description: "Quote and decision lifecycle" });
  spatial.upsertZone({ zoneId: "governance", roomId: "authority-wing", name: "Governance", description: "Policy and authority chain" });
  spatial.upsertPath({ pathId: "quotes-to-governance", fromZoneId: "quotes", toZoneId: "governance", relation: "links" });

  spatial.upsertAtom({
    atomId: "quote-812",
    type: "Quote",
    relationships: ["customer-44", "part-991", "decision-91"],
    timestamp: "2026-06-03T00:00:00.000Z",
    authorityRoot: "root-1",
  });
  spatial.upsertAtom({ atomId: "customer-44", type: "Customer", relationships: [], timestamp: "2026-06-03T00:00:00.000Z", authorityRoot: "root-1" });
  spatial.upsertAtom({ atomId: "decision-91", type: "Decision", relationships: [], timestamp: "2026-06-03T00:00:00.000Z", authorityRoot: "root-1" });
  spatial.upsertAtom({ atomId: "approval-policy:v4", type: "Policy", relationships: [], timestamp: "2026-06-03T00:00:00.000Z", authorityRoot: "root-1" });
  spatial.upsertAtom({ atomId: "governance-rule:12", type: "GovernanceRule", relationships: [], timestamp: "2026-06-03T00:00:00.000Z", authorityRoot: "root-1" });
  spatial.upsertAtom({ atomId: "deployment-version:1.0.0", type: "Deployment", relationships: [], timestamp: "2026-06-03T00:00:00.000Z", authorityRoot: "root-1" });
  spatial.upsertAtom({ atomId: "authority-signature:sig-1", type: "AuthoritySignature", relationships: [], timestamp: "2026-06-03T00:00:00.000Z", authorityRoot: "root-1" });
  spatial.addRelationship({ fromAtomId: "customer-44", toAtomId: "quote-812", relation: "requested", timestamp: "2026-06-03T00:00:00.000Z" });
  spatial.addRelationship({ fromAtomId: "decision-91", toAtomId: "quote-812", relation: "approved", timestamp: "2026-06-03T00:00:01.000Z" });
  spatial.addRelationship({ fromAtomId: "decision-91", toAtomId: "approval-policy:v4", relation: "influenced_by", timestamp: "2026-06-03T00:00:01.000Z" });
  spatial.addRelationship({ fromAtomId: "approval-policy:v4", toAtomId: "governance-rule:12", relation: "originated_from", timestamp: "2026-06-03T00:00:01.000Z" });
  spatial.addRelationship({ fromAtomId: "governance-rule:12", toAtomId: "deployment-version:1.0.0", relation: "modified_by", timestamp: "2026-06-03T00:00:01.000Z" });
  spatial.addRelationship({ fromAtomId: "deployment-version:1.0.0", toAtomId: "authority-signature:sig-1", relation: "verified_by", timestamp: "2026-06-03T00:00:01.000Z" });
  spatial.addRelationship({ fromAtomId: "lineage-91", toAtomId: "decision-91", relation: "lineage_of", timestamp: "2026-06-03T00:00:01.000Z" });

  spatial.setAtomLocation({ atomId: "quote-812", roomId: "customer-wing", zoneId: "quotes" });
  spatial.setAtomLocation({ atomId: "decision-91", roomId: "customer-wing", zoneId: "quotes" });
  spatial.setAtomLocation({ atomId: "approval-policy:v4", roomId: "authority-wing", zoneId: "governance" });
  spatial.setAtomLocation({ atomId: "governance-rule:12", roomId: "authority-wing", zoneId: "governance" });
  spatial.setAtomLocation({ atomId: "authority-signature:sig-1", roomId: "authority-wing", zoneId: "governance" });

  const challenges = buildMemoryChallenges(["quote-812"]);
  const weak = runWeakSolver(challenges);
  const queryEngine = new ReconstructionQueryEngine(spatial);
  const replaySpatial = runSpatialSolver(queryEngine, challenges);
  const strong = runStrongSolver(queryEngine, challenges);
  const result = judgeMemorySolvers(challenges, weak, strong, replaySpatial);

  await writeJson(outputPath, result);
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMemoryJudge()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.stack ?? error.message : String(error);
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    });
}
