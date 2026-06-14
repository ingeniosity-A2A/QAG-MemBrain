import { describe, expect, it } from "vitest";
import { CANONICAL_AUTHORITY_ORDER, type AuthorityReplayRecord } from "../../authority/replay/replayContract.js";
import { validateAuthorityReplayRecord } from "../../authority/replay/replayValidator.js";
import { computeDecisionHash } from "../../lineage/hashing/decisionHash.js";
import type { DecisionLineage } from "../../lineage/schemas/decisionLineage.js";
import type { DecisionLineageInput } from "../../lineage/schemas/decisionLineage.js";

function buildLineage(): DecisionLineage {
  const input: DecisionLineageInput = {
    decisionId: "dec-001",
    memoryAtoms: ["mem-1"],
    graphNodes: ["graph-1"],
    policiesApplied: ["policy-1"],
    policyEvaluations: [
      {
        policyId: "policy-1",
        result: "allow" as const,
        reason: "recorded evidence allows",
        evidence: ["mem-1"],
        timestamp: "2026-06-03T06:01:00.000Z",
      },
    ],
    policyResults: ["allow"],
    policyEvidence: ["mem-1"],
    finalPolicyOutcome: "allow",
    timelineEvents: ["time-1"],
    executivePlanId: "plan-1",
    timestamp: "2026-06-03T06:01:00.000Z",
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
    timestamp: input.timestamp ?? "2026-06-03T06:01:00.000Z",
    decisionHash: computeDecisionHash(input),
  };
}

function buildRecord(lineage: DecisionLineage): AuthorityReplayRecord {
  return {
    decisionId: lineage.decisionId,
    lineageId: lineage.decisionId,
    authorityOrder: [...CANONICAL_AUTHORITY_ORDER],
    memoryReferences: [...lineage.memoryAtoms],
    graphReferences: [...lineage.graphNodes],
    timelineReferences: [...lineage.timelineEvents],
    policyReferences: [...lineage.policiesApplied],
    finalPolicyOutcome: lineage.finalPolicyOutcome,
    storedDecisionHash: lineage.decisionHash,
    reconstructedDecisionHash: lineage.decisionHash,
    hashMatch: true,
    policyMatch: true,
    referencesValid: true,
    reconstructionMatch: true,
    timestamp: lineage.timestamp,
  };
}

describe("Authority replay validator", () => {
  it("verifies replay invariants end to end", async () => {
    const lineage = buildLineage();
    const record = buildRecord(lineage);

    const result = await validateAuthorityReplayRecord(
      record,
      {
        loadLineage: async (lineageId) => (lineageId === lineage.decisionId ? lineage : null),
        loadMemoryReference: async (id) => (id === "mem-1" ? { id } : null),
        loadGraphReference: async (id) => (id === "graph-1" ? { id } : null),
        loadTimelineReference: async (id) => (id === "time-1" ? { id } : null),
        loadPolicyReference: async (id) => (id === "policy-1" ? { id } : null),
      },
      {
        expectedDecisionId: lineage.decisionId,
        expectedLineageId: lineage.decisionId,
      },
    );

    expect(result.hashMatch).toBe(true);
    expect(result.policyMatch).toBe(true);
    expect(result.referencesValid).toBe(true);
    expect(result.lineageIdImmutable).toBe(true);
    expect(result.decisionIdImmutable).toBe(true);
    expect(result.authorityOrderValid).toBe(true);
    expect(result.reconstructionMatch).toBe(true);
    expect(result.status).toBe("VERIFIED");
  });

  it("fails when authority order and stored verification flags drift", async () => {
    const lineage = buildLineage();
    const record = {
      ...buildRecord(lineage),
      authorityOrder: ["JSONL", "Neo4j", "Tashi", "GSAP", "Runtime"],
      hashMatch: false,
      reconstructionMatch: false,
    } satisfies AuthorityReplayRecord;

    const result = await validateAuthorityReplayRecord(record, {
      loadLineage: async (lineageId) => (lineageId === lineage.decisionId ? lineage : null),
      loadMemoryReference: async (id) => (id === "mem-1" ? { id } : null),
      loadGraphReference: async (id) => (id === "graph-1" ? { id } : null),
      loadTimelineReference: async (id) => (id === "time-1" ? { id } : null),
      loadPolicyReference: async (id) => (id === "policy-1" ? { id } : null),
    });

    expect(result.authorityOrderValid).toBe(false);
    expect(result.reconstructionMatch).toBe(false);
    expect(result.status).toBe("FAILED");
    expect(result.issues).toContain("authority order invariant failed");
    expect(result.issues).toContain("stored hashMatch flag mismatch");
  });

  it("fails when references or immutable ids do not match lineage", async () => {
    const lineage = buildLineage();
    const record = {
      ...buildRecord(lineage),
      decisionId: "dec-other",
      lineageId: "lin-other",
      referencesValid: false,
      reconstructionMatch: false,
    } satisfies AuthorityReplayRecord;

    const result = await validateAuthorityReplayRecord(record, {
      loadLineage: async () => lineage,
      loadMemoryReference: async () => null,
      loadGraphReference: async (id) => (id === "graph-1" ? { id } : null),
      loadTimelineReference: async (id) => (id === "time-1" ? { id } : null),
      loadPolicyReference: async (id) => (id === "policy-1" ? { id } : null),
    });

    expect(result.referencesValid).toBe(false);
    expect(result.lineageIdImmutable).toBe(false);
    expect(result.decisionIdImmutable).toBe(false);
    expect(result.status).toBe("FAILED");
    expect(result.issues).toContain("one or more references are missing");
    expect(result.issues).toContain("lineageId immutable invariant failed");
    expect(result.issues).toContain("decisionId immutable invariant failed");
  });
});