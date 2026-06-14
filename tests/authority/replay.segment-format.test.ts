import { createPrivateKey, generateKeyPairSync, sign as signBuffer } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ReplayRecord } from "../../authority/service/replayRecord.js";
import { buildReplaySegments, computeMerkleRoot } from "../../authority/replay/replaySegment.js";

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

describe("Replay segment format", () => {
  it("creates segment records with merkle root and checkpoint mapping", () => {
    const records = [buildRecord(1), buildRecord(2), buildRecord(3)];
    const keyPair = generateKeyPairSync("ed25519");
    const privatePem = keyPair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const publicPem = keyPair.publicKey.export({ type: "spki", format: "pem" }).toString();

    const fakeSigner = {
      getAuthorityId: () => "test-authority",
      getSignerId: () => "test-authority",
      getPublicKey: () => publicPem,
      sign: (data: Uint8Array) => signBuffer(null, data, createPrivateKey(privatePem)).toString("base64"),
    };

    const segments = buildReplaySegments(records, 2, fakeSigner);

    expect(segments).toHaveLength(2);
    expect(segments[0].segmentId).toBe("segment-1-2");
    expect(segments[0].checkpointRecordIndex).toBe(1);
    expect(segments[0].merkleRoot).toBe(computeMerkleRoot([records[0].replayHash, records[1].replayHash]));
    expect(segments[1].segmentId).toBe("segment-3-3");
    expect(segments[1].checkpointRecordIndex).toBe(2);
    expect(segments[1].authorityId).toBe("test-authority");
  });
});
