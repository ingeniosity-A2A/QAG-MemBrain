import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DecisionRecord } from "../../audit/decisions/decisionRecord.js";
import { AuthorityReplayEngine } from "../../authority/execution/authorityReplayEngine.js";
import { AuthorityReplayService } from "../../authority/service/authorityReplayService.js";
import { JsonlReplayRepository } from "../../authority/persistence/replayRepository.js";
import { computeDecisionHash } from "../../lineage/hashing/decisionHash.js";
import { DecisionLineage, DecisionLineageInput } from "../../lineage/schemas/decisionLineage.js";

function buildLineage(decisionId: string): DecisionLineage {
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
        timestamp: "2026-06-03T09:01:00.000Z",
      },
    ],
    policyResults: ["allow"],
    policyEvidence: ["mem-1"],
    finalPolicyOutcome: "allow",
    timelineEvents: ["time-1"],
    executivePlanId: "plan-1",
    timestamp: "2026-06-03T09:01:00.000Z",
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
    timestamp: input.timestamp ?? "2026-06-03T09:01:00.000Z",
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

describe("Authority replay session", () => {
  it("replays all decisions in a session", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qag-replay-session-"));
    try {
    const lineage = buildLineage("decision-session-1");
    const decision = buildDecision(lineage);
    const service = new AuthorityReplayService({
      loadDecision: async () => decision,
      loadLineage: async () => lineage,
      loadMemoryReference: async (id) => ({ id }),
      loadGraphReference: async (id) => ({ id }),
      loadTimelineReference: async (id) => ({ id }),
      loadPolicyReference: async (id) => ({ id }),
      listDecisionIdsBySession: async (sessionId) => (sessionId === "session-1" ? [decision.decisionId] : []),
      listDecisionIdsByLineage: async () => [decision.decisionId],
      listDecisionIdsByRange: async () => [decision.decisionId],
      replayRepository: new JsonlReplayRepository(join(dir, "replay.jsonl")),
    });

    const responses = await service.replaySession("session-1");
    expect(responses).toHaveLength(1);
    expect(responses[0].status).toBe("VERIFIED");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});