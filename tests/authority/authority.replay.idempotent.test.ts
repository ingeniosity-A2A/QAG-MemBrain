import { describe, expect, it } from "vitest";
import { DecisionRecord } from "../../audit/decisions/decisionRecord.js";
import { AuthorityReplayEngine } from "../../authority/execution/authorityReplayEngine.js";
import { ReplayRepository } from "../../authority/persistence/replayRepository.js";
import { AuthorityReplayService } from "../../authority/service/authorityReplayService.js";
import { computeDecisionHash } from "../../lineage/hashing/decisionHash.js";
import { DecisionLineage, DecisionLineageInput } from "../../lineage/schemas/decisionLineage.js";

function buildLineage(): DecisionLineage {
  const input: DecisionLineageInput = {
    decisionId: "decision-idempotent-1",
    memoryAtoms: ["mem-1"],
    graphNodes: ["graph-1"],
    policiesApplied: ["policy-1"],
    policyEvaluations: [
      {
        policyId: "policy-1",
        result: "allow",
        reason: "allow",
        evidence: ["mem-1"],
        timestamp: "2026-06-03T09:03:00.000Z",
      },
    ],
    policyResults: ["allow"],
    policyEvidence: ["mem-1"],
    finalPolicyOutcome: "allow",
    timelineEvents: ["time-1"],
    executivePlanId: "plan-1",
    timestamp: "2026-06-03T09:03:00.000Z",
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
    timestamp: input.timestamp ?? "2026-06-03T09:03:00.000Z",
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

describe("Authority replay idempotency", () => {
  it("returns identical outcomes on repeated replay and does not mutate lineage", async () => {
    const lineage = buildLineage();
    const decision = buildDecision(lineage);
    const replayRecords: Array<{
      replayId: string;
      decisionId: string;
      lineageId: string;
      status: "VERIFIED" | "FAILED";
      failures: string[];
      startedAt: string;
      completedAt: string;
    }> = [];

    const replayRepository: ReplayRepository = {
      append: async (record) => {
        replayRecords.push(record);
      },
      list: async () => [...replayRecords],
    };

    const service = new AuthorityReplayService({
      loadDecision: async () => decision,
      loadLineage: async () => lineage,
      loadMemoryReference: async (id) => ({ id }),
      loadGraphReference: async (id) => ({ id }),
      loadTimelineReference: async (id) => ({ id }),
      loadPolicyReference: async (id) => ({ id }),
      listDecisionIdsBySession: async () => [],
      listDecisionIdsByLineage: async () => [decision.decisionId],
      listDecisionIdsByRange: async () => [decision.decisionId],
      replayRepository,
    });

    const first = await service.replay(decision.decisionId);
    const second = await service.replay(decision.decisionId);

    expect(first.status).toBe(second.status);
    expect(first.failures).toEqual(second.failures);
    const records = await service.listReplayRecords();
    expect(records).toHaveLength(2);
    expect(lineage.decisionHash).toBe(decision.decisionHash);
    expect(lineage.finalPolicyOutcome).toBe("allow");
  });
});