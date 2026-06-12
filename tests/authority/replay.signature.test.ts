import { describe, expect, it } from "vitest";
import { sealReplayRecord, verifyReplayRecord } from "../../authority/persistence/replayProof.js";
import { CANONICAL_AUTHORITY_ORDER } from "../../authority/replay/replayContract.js";
import { ReplayRecordInput } from "../../authority/service/replayRecord.js";

function buildReplayRecordInput(): ReplayRecordInput {
  return {
    replayId: "rep-signature-1",
    decisionId: "decision-signature-1",
    lineageId: "lineage-signature-1",
    governanceVersion: "1.5",
    governanceHash: "governance-hash-signature-1",
    manifestHash: "manifest-hash-signature-1",
    attestationHash: "attestation-hash-signature-1",
    runtimeVersion: "0.1.0",
    runtimeHash: "runtime-hash-signature-1",
    runtimeStartedAt: "2026-06-03T00:00:00.000Z",
    runtimeHost: "signature-host",
    runtimeProcessId: 5001,
    runtimeNodeVersion: "v22.0.0",
    runtimePlatform: "linux",
    gitCommit: "5e300b0d9aa609a973e25420a884e30af88b070a",
    buildHash: "build-hash-signature-1",
    buildTimestamp: "2026-06-03T00:00:00.000Z",
    worktreeDirty: true,
    deploymentVersion: "1.0.0",
    deploymentHash: "deployment-hash-signature-1",
    releaseId: "release-signature-1",
    environment: "development",
    status: "VERIFIED",
    failureReasons: [],
    authorityOrder: [...CANONICAL_AUTHORITY_ORDER],
    timestamp: "2026-06-03T00:00:01.000Z",
    startedAt: "2026-06-03T00:00:00.000Z",
    completedAt: "2026-06-03T00:00:01.000Z",
  };
}

describe("Replay signature integrity", () => {
  it("passes with a valid signature", () => {
    const sealed = sealReplayRecord(buildReplayRecordInput());
    expect(verifyReplayRecord(sealed)).toBe(true);
  });

  it("fails when replayHash is tampered", () => {
    const sealed = sealReplayRecord(buildReplayRecordInput());
    const tampered = {
      ...sealed,
      replayHash: `${sealed.replayHash}-tampered`,
    };

    expect(verifyReplayRecord(tampered)).toBe(false);
  });

  it("fails when governanceHash is tampered", () => {
    const sealed = sealReplayRecord(buildReplayRecordInput());
    const tampered = {
      ...sealed,
      governanceHash: `${sealed.governanceHash}-tampered`,
    };

    expect(verifyReplayRecord(tampered)).toBe(false);
  });

  it("fails when runtimeHash is tampered", () => {
    const sealed = sealReplayRecord(buildReplayRecordInput());
    const tampered = {
      ...sealed,
      runtimeHash: `${sealed.runtimeHash}-tampered`,
    };

    expect(verifyReplayRecord(tampered)).toBe(false);
  });
});
