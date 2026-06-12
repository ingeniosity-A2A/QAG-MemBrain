import { describe, expect, it } from "vitest";
import { computeReplayHash } from "../../authority/persistence/replayHash.js";
import { CANONICAL_AUTHORITY_ORDER } from "../../authority/replay/replayContract.js";
import { ReplayRecordInput } from "../../authority/service/replayRecord.js";

describe("Authority replay hashing", () => {
  it("produces a stable hash for identical replay records", () => {
    const record: ReplayRecordInput = {
      replayId: "rep-stable-1",
      decisionId: "dec-1",
      lineageId: "lin-1",
      governanceVersion: "1.4",
      governanceHash: "gov-hash-1",
      manifestHash: "manifest-hash-1",
      attestationHash: "attestation-hash-1",
      runtimeVersion: "0.1.0",
      runtimeHash: "runtime-hash-1",
      runtimeStartedAt: "2026-06-03T00:00:00.000Z",
      runtimeHost: "host-1",
      runtimeProcessId: 1001,
      runtimeNodeVersion: "v22.0.0",
      runtimePlatform: "linux",
      gitCommit: "5e300b0d9aa609a973e25420a884e30af88b070a",
      buildHash: "build-hash-1",
      buildTimestamp: "2026-06-03T00:00:00.000Z",
      worktreeDirty: true,
      deploymentVersion: "1.0.0",
      deploymentHash: "deployment-hash-1",
      releaseId: "release-1",
      environment: "development",
      status: "VERIFIED",
      failureReasons: [],
      authorityOrder: [...CANONICAL_AUTHORITY_ORDER],
      timestamp: "2026-06-03T22:00:01.000Z",
      startedAt: "2026-06-03T22:00:00.000Z",
      completedAt: "2026-06-03T22:00:01.000Z",
    };

    expect(computeReplayHash(record)).toBe(computeReplayHash(record));
  });

  it("changes hash when an authority-significant field changes", () => {
    const base: ReplayRecordInput = {
      replayId: "rep-stable-2",
      decisionId: "dec-2",
      lineageId: "lin-2",
      governanceVersion: "1.4",
      governanceHash: "gov-hash-2",
      manifestHash: "manifest-hash-2",
      attestationHash: "attestation-hash-2",
      runtimeVersion: "0.1.0",
      runtimeHash: "runtime-hash-2",
      runtimeStartedAt: "2026-06-03T00:00:00.000Z",
      runtimeHost: "host-2",
      runtimeProcessId: 1002,
      runtimeNodeVersion: "v22.0.0",
      runtimePlatform: "linux",
      gitCommit: "5e300b0d9aa609a973e25420a884e30af88b070a",
      buildHash: "build-hash-2",
      buildTimestamp: "2026-06-03T00:00:00.000Z",
      worktreeDirty: true,
      deploymentVersion: "1.0.0",
      deploymentHash: "deployment-hash-2",
      releaseId: "release-2",
      environment: "development",
      status: "VERIFIED",
      failureReasons: [],
      authorityOrder: [...CANONICAL_AUTHORITY_ORDER],
      timestamp: "2026-06-03T22:01:01.000Z",
      startedAt: "2026-06-03T22:01:00.000Z",
      completedAt: "2026-06-03T22:01:01.000Z",
    };

    const changed: ReplayRecordInput = {
      ...base,
      status: "FAILED",
      failureReasons: ["HASH_MISMATCH"],
    };

    expect(computeReplayHash(base)).not.toBe(computeReplayHash(changed));
  });
});
