import { describe, expect, it } from "vitest";
import { DecisionRecord } from "../../audit/decisions/decisionRecord.js";
import { AuthorityReplayEngine } from "../../authority/execution/authorityReplayEngine.js";
import { AuthorityReplayMetrics } from "../../authority/service/authorityReplayMetrics.js";
import { AuthorityReplayService } from "../../authority/service/authorityReplayService.js";
import { ReplayRepository } from "../../authority/persistence/replayRepository.js";
import { computeDecisionHash } from "../../lineage/hashing/decisionHash.js";
import { DecisionLineage, DecisionLineageInput } from "../../lineage/schemas/decisionLineage.js";
import { ReplayRecord, ReplayRecordInput } from "../../authority/service/replayRecord.js";

function buildLineage(decisionId = "decision-service-1"): DecisionLineage {
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
        timestamp: "2026-06-03T09:00:00.000Z",
      },
    ],
    policyResults: ["allow"],
    policyEvidence: ["mem-1"],
    finalPolicyOutcome: "allow",
    timelineEvents: ["time-1"],
    executivePlanId: "plan-1",
    timestamp: "2026-06-03T09:00:00.000Z",
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
    timestamp: input.timestamp ?? "2026-06-03T09:00:00.000Z",
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

function buildService(decisions: Array<{ decision: DecisionRecord; lineage: DecisionLineage }>) {
  const inMemoryReplayRecords: ReplayRecord[] = [];

  const replayRepository: ReplayRepository = {
    append: async (record: ReplayRecordInput) => {
      inMemoryReplayRecords.push({
        ...record,
        replayHash: "test-hash",
      });
    },
    list: async () => [...inMemoryReplayRecords],
  };

  return new AuthorityReplayService({
    loadDecision: async (decisionId) =>
      decisions.find((item) => item.decision.decisionId === decisionId)?.decision ?? null,
    loadLineage: async (lineageId) =>
      decisions.find((item) => item.lineage.decisionId === lineageId)?.lineage ?? null,
    loadMemoryReference: async (id) => ({ id }),
    loadGraphReference: async (id) => ({ id }),
    loadTimelineReference: async (id) => ({ id }),
    loadPolicyReference: async (id) => ({ id }),
    listDecisionIdsBySession: async (sessionId) =>
      sessionId === "session-1" ? decisions.map((item) => item.decision.decisionId) : [],
    listDecisionIdsByLineage: async (lineageId) =>
      decisions.filter((item) => item.lineage.decisionId === lineageId).map((item) => item.decision.decisionId),
    listDecisionIdsByRange: async () => decisions.map((item) => item.decision.decisionId),
    replayRepository,
  });
}

describe("Authority replay service", () => {
  it("replays a single decision and updates records", async () => {
    const lineage = buildLineage();
    const decision = buildDecision(lineage);
    const service = buildService([{ decision, lineage }]);
    const metrics = new AuthorityReplayMetrics();

    const response = await service.replay(decision.decisionId);
    metrics.recordReplay(5, response.status, response.failures);

    expect(response.status).toBe("VERIFIED");
    expect(response.failures).toEqual([]);
    const records = await service.listReplayRecords();
    expect(records).toHaveLength(1);
    expect(records[0].failureReasons).toEqual([]);
    expect(records[0].authorityOrder).toEqual(["JSONL", "Tashi", "Neo4j", "GSAP", "Runtime"]);
    expect(records[0].timestamp.length).toBeGreaterThan(0);
    expect(metrics.snapshot().totalReplays).toBe(1);
    expect(metrics.snapshot().verifiedReplays).toBe(1);
  });
});