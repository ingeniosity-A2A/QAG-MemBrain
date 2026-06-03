import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ReplayRecord } from "../../authority/service/replayRecord.js";
import { verifyArtifact } from "../../authority/verification/verifyArtifact.js";

const cleanupTargets: string[] = [];

afterEach(async () => {
  while (cleanupTargets.length > 0) {
    const path = cleanupTargets.pop();
    if (path) {
      await rm(path, { recursive: true, force: true });
    }
  }
});

function buildRecord(decisionId: string, replayHash: string): ReplayRecord {
  return {
    replayId: `rep-${decisionId}`,
    decisionId,
    lineageId: `lin-${decisionId}`,
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
    replayHash,
    proof: { algorithm: "sha256" },
    signature: {
      signatureId: `sig-${decisionId}`,
      signature: "invalid",
      algorithm: "ed25519",
      signedAt: "2026-06-03T00:00:01.000Z",
      authorityId: "ava007-authority-v2",
      signerId: "ava007-authority-v2",
      artifactHash: "invalid",
    },
  } as ReplayRecord;
}

describe("Verification modes", () => {
  it("supports full, checkpoint, and merkle verification modes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qag-verify-modes-"));
    cleanupTargets.push(dir);

    const artifactPath = join(dir, "replay.jsonl");
    const first = buildRecord("decision-1", "hash-1");
    const second = buildRecord("decision-2", "hash-2");

    await writeFile(artifactPath, `${JSON.stringify(first)}\n${JSON.stringify(second)}\n`, "utf8");

    const full = await verifyArtifact(
      artifactPath,
      {
        verifyReplay: (record) => ({
          authorityId: "ava007-authority-v2",
          authorityValid: record.decisionId !== "decision-1",
          keyRegistered: record.decisionId !== "decision-1",
          signatureValid: record.decisionId !== "decision-1",
          replayValid: record.decisionId !== "decision-1",
          proofValid: true,
          issues: record.decisionId === "decision-1" ? ["record invalid"] : [],
        }),
        verifyGovernance: async () => true,
        verifyBuild: () => true,
        verifyDeployment: () => true,
        verifyRuntime: () => true,
      },
      { mode: "full", checkpointInterval: 2 },
    );

    const checkpoint = await verifyArtifact(
      artifactPath,
      {
        verifyReplay: (record) => ({
          authorityId: "ava007-authority-v2",
          authorityValid: record.decisionId !== "decision-1",
          keyRegistered: record.decisionId !== "decision-1",
          signatureValid: record.decisionId !== "decision-1",
          replayValid: record.decisionId !== "decision-1",
          proofValid: true,
          issues: record.decisionId === "decision-1" ? ["record invalid"] : [],
        }),
        verifyGovernance: async () => true,
        verifyBuild: () => true,
        verifyDeployment: () => true,
        verifyRuntime: () => true,
      },
      { mode: "checkpoint", checkpointInterval: 2 },
    );

    const merkle = await verifyArtifact(
      artifactPath,
      {
        verifyReplay: () => ({
          authorityId: "ava007-authority-v2",
          authorityValid: false,
          keyRegistered: false,
          signatureValid: false,
          replayValid: false,
          proofValid: false,
          issues: ["unused in merkle"],
        }),
        verifyGovernance: async () => false,
        verifyBuild: () => false,
        verifyDeployment: () => false,
        verifyRuntime: () => false,
      },
      { mode: "merkle", checkpointInterval: 2 },
    );

    expect(full.mode).toBe("full");
    expect(full.recordsAnalyzed).toBe(2);
    expect(full.trusted).toBe(false);

    expect(checkpoint.mode).toBe("checkpoint");
    expect(checkpoint.segmentsAnalyzed).toBe(1);
    expect(checkpoint.trusted).toBe(true);

    expect(merkle.mode).toBe("merkle");
    expect(merkle.recordsAnalyzed).toBe(2);
    expect(merkle.trusted).toBe(true);
  });
});
