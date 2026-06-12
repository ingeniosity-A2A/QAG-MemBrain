import { describe, expect, it } from "vitest";
import { CANONICAL_AUTHORITY_ORDER, type AuthorityReplayRecord } from "../../authority/replay/replayContract.js";
import { assertAuthorityReplayRecordShape } from "../../authority/replay/replaySchema.js";

describe("Authority replay contract", () => {
  it("accepts a complete replay record", () => {
    const record: AuthorityReplayRecord = {
      decisionId: "dec-001",
      lineageId: "dec-001",
      authorityOrder: [...CANONICAL_AUTHORITY_ORDER],
      memoryReferences: ["mem-1"],
      graphReferences: ["graph-1"],
      timelineReferences: ["time-1"],
      policyReferences: ["policy-1"],
      finalPolicyOutcome: "allow",
      storedDecisionHash: "hash-a",
      reconstructedDecisionHash: "hash-a",
      hashMatch: true,
      policyMatch: true,
      referencesValid: true,
      reconstructionMatch: true,
      timestamp: "2026-06-03T06:00:00.000Z",
    };

    expect(() => assertAuthorityReplayRecordShape(record)).not.toThrow();
  });

  it("rejects records missing independent verification fields", () => {
    const record = {
      decisionId: "dec-001",
      lineageId: "dec-001",
      authorityOrder: ["JSONL", "Tashi", "Neo4j", "GSAP", "Runtime"],
      memoryReferences: ["mem-1"],
      graphReferences: ["graph-1"],
      timelineReferences: ["time-1"],
      policyReferences: ["policy-1"],
      finalPolicyOutcome: "allow",
      reconstructedDecisionHash: "hash-a",
      hashMatch: true,
      policyMatch: true,
      referencesValid: true,
      reconstructionMatch: true,
      timestamp: "2026-06-03T06:00:00.000Z",
    } as unknown as AuthorityReplayRecord;

    expect(() => assertAuthorityReplayRecordShape(record)).toThrow(/storedDecisionHash/);
  });
});