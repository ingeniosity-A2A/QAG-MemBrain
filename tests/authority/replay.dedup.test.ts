import { describe, expect, it } from "vitest";
import { ReplayRecord } from "../../authority/service/replayRecord.js";
import { dedupReplayRecords } from "../../authority/replay/replayDedup.js";

function buildRecord(id: number): ReplayRecord {
  return {
    replayId: `rep-${id}`,
    decisionId: `decision-${id}`,
    lineageId: `lineage-${id}`,
    governanceVersion: "1.5",
    governanceHash: "gov-hash",
    manifestHash: "manifest-hash",
    attestationHash: "attestation-hash",
    runtimeVersion: "0.1.0",
    runtimeHash: "runtime-hash",
    runtimeStartedAt: "2026-06-03T00:00:00.000Z",
    runtimeHost: "host",
    runtimeProcessId: 100,
    runtimeNodeVersion: "v22.0.0",
    runtimePlatform: "linux",
    gitCommit: "5e300b0d9aa609a973e25420a884e30af88b070a",
    buildHash: "build-hash",
    buildTimestamp: "2026-06-03T00:00:00.000Z",
    worktreeDirty: true,
    deploymentVersion: "1.0.0",
    deploymentHash: "deployment-hash",
    releaseId: "release-1",
    environment: "development",
    status: "VERIFIED",
    failureReasons: [],
    authorityOrder: ["JSONL", "Tashi", "Neo4j", "GSAP", "Runtime"],
    timestamp: "2026-06-03T00:00:01.000Z",
    startedAt: "2026-06-03T00:00:00.000Z",
    completedAt: "2026-06-03T00:00:01.000Z",
    replayHash: `replay-hash-${id}`,
    proof: { algorithm: "sha256" },
    signature: {
      signatureId: `sig-${id}`,
      signature: "invalid",
      algorithm: "ed25519",
      signedAt: "2026-06-03T00:00:01.000Z",
      authorityId: "ava007-authority-v2",
      signerId: "ava007-authority-v2",
      artifactHash: `artifact-hash-${id}`,
    },
  } as ReplayRecord;
}

describe("Replay trust payload dedup", () => {
  it("emits checkpoint trust snapshots and delta entries", () => {
    const dedup = dedupReplayRecords([buildRecord(1), buildRecord(2), buildRecord(3)], 2);
    const checkpoints = dedup.filter((entry) => entry.entryType === "checkpoint");
    const deltas = dedup.filter((entry) => entry.entryType === "delta");

    expect(checkpoints).toHaveLength(2);
    expect(deltas).toHaveLength(3);

    const firstCheckpoint = checkpoints[0];
    if (firstCheckpoint.entryType === "checkpoint") {
      expect(firstCheckpoint.segmentId).toBe("segment-1-2");
      expect(firstCheckpoint.trust.governanceVersion).toBe("1.5");
      expect(firstCheckpoint.trust.signature.signerId).toBe("ava007-authority-v2");
    }
  });
});
