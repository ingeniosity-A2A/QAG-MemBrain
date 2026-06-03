import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DecisionRecord } from "../../audit/decisions/decisionRecord.js";
import { JsonlReplayRepository } from "../../authority/persistence/replayRepository.js";
import { AuthorityReplayService } from "../../authority/service/authorityReplayService.js";
import { computeDecisionHash } from "../../lineage/hashing/decisionHash.js";
import { DecisionLineage, DecisionLineageInput } from "../../lineage/schemas/decisionLineage.js";

const cleanupTargets: string[] = [];

afterEach(async () => {
  while (cleanupTargets.length > 0) {
    const path = cleanupTargets.pop();
    if (path) {
      await rm(path, { recursive: true, force: true });
    }
  }
});

function buildLineage(decisionId = "decision-persist-1"): DecisionLineage {
  const input: DecisionLineageInput = {
    decisionId,
    memoryAtoms: ["mem-1"],
    graphNodes: ["graph-1"],
    policiesApplied: ["policy-1"],
    policyEvaluations: [
      {
        policyId: "policy-1",
        result: "allow",
        reason: "allow",
        evidence: ["mem-1"],
        timestamp: "2026-06-03T10:00:00.000Z",
      },
    ],
    policyResults: ["allow"],
    policyEvidence: ["mem-1"],
    finalPolicyOutcome: "allow",
    timelineEvents: ["time-1"],
    executivePlanId: "plan-1",
    timestamp: "2026-06-03T10:00:00.000Z",
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
    timestamp: input.timestamp ?? "2026-06-03T10:00:00.000Z",
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

function buildService(
  decision: DecisionRecord,
  lineage: DecisionLineage,
  replayRepository: JsonlReplayRepository,
): AuthorityReplayService {
  return new AuthorityReplayService({
    loadDecision: async (decisionId) => (decisionId === decision.decisionId ? decision : null),
    loadLineage: async (lineageId) => (lineageId === lineage.decisionId ? lineage : null),
    loadMemoryReference: async (id) => ({ id }),
    loadGraphReference: async (id) => ({ id }),
    loadTimelineReference: async (id) => ({ id }),
    loadPolicyReference: async (id) => ({ id }),
    listDecisionIdsBySession: async () => [decision.decisionId],
    listDecisionIdsByLineage: async () => [decision.decisionId],
    listDecisionIdsByRange: async () => [decision.decisionId],
    replayRepository,
  });
}

describe("Authority replay persistence", () => {
  it("keeps replay records after service restart", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "qag-membrain-replay-"));
    cleanupTargets.push(tempDir);

    const replayLedgerPath = join(tempDir, "replay.jsonl");
    const replayRepository = new JsonlReplayRepository(replayLedgerPath);

    const lineage = buildLineage();
    const decision = buildDecision(lineage);

    const serviceA = buildService(decision, lineage, replayRepository);
    const response = await serviceA.replay(decision.decisionId);
    expect(response.status).toBe("VERIFIED");

    const serviceB = buildService(decision, lineage, replayRepository);
    const persisted = await serviceB.listReplayRecords();

    expect(persisted).toHaveLength(1);
    expect(persisted[0].decisionId).toBe(decision.decisionId);
    expect(persisted[0].status).toBe("VERIFIED");
    expect(persisted[0].failureReasons).toEqual([]);
    expect(persisted[0].authorityOrder).toEqual(["JSONL", "Tashi", "Neo4j", "GSAP", "Runtime"]);
    expect(persisted[0].replayHash.length).toBeGreaterThan(0);
  });
});
