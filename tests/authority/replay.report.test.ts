import { describe, expect, it } from "vitest";
import type { AuthorityReplayRecord } from "../../authority/replay/replayContract.js";
import { CANONICAL_AUTHORITY_ORDER } from "../../authority/replay/replayContract.js";
import { buildReplayReport } from "../../authority/replay/replayReport.js";

const baseRecord: AuthorityReplayRecord = {
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
  timestamp: "2026-06-03T06:05:00.000Z",
};

describe("Authority replay report", () => {
  it("builds a verified report", () => {
    const report = buildReplayReport(baseRecord, {
      hashMatch: true,
      policyMatch: true,
      referencesValid: true,
      lineageIdImmutable: true,
      decisionIdImmutable: true,
      authorityOrderValid: true,
      reconstructionMatch: true,
      status: "VERIFIED",
      issues: [],
    });

    expect(report.status).toBe("VERIFIED");
    expect(report.authorityOrderValid).toBe(true);
    expect(report.reconstructionMatch).toBe(true);
  });

  it("builds a failed report with issues", () => {
    const report = buildReplayReport(baseRecord, {
      hashMatch: false,
      policyMatch: true,
      referencesValid: false,
      lineageIdImmutable: true,
      decisionIdImmutable: true,
      authorityOrderValid: false,
      reconstructionMatch: false,
      status: "FAILED",
      issues: ["stored hash and reconstructed hash mismatch"],
    });

    expect(report.status).toBe("FAILED");
    expect(report.hashMatch).toBe(false);
    expect(report.referencesValid).toBe(false);
    expect(report.issues).toContain("stored hash and reconstructed hash mismatch");
  });
});