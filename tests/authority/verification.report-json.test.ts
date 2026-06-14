import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { verifyArtifact } from "../../authority/verification/verifyArtifact.js";
import { ReplayRecord } from "../../authority/service/replayRecord.js";

const cleanupTargets: string[] = [];

afterEach(async () => {
  while (cleanupTargets.length > 0) {
    const path = cleanupTargets.pop();
    if (path) {
      await rm(path, { recursive: true, force: true });
    }
  }
});

describe("Verification report JSON", () => {
  it("returns machine-readable verification fields", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qag-verify-report-"));
    cleanupTargets.push(dir);

    const artifactPath = join(dir, "replay.json");
    const replay = {
      replayId: "rep-json-1",
      decisionId: "decision-json-1",
      lineageId: "lineage-json-1",
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
      replayHash: "not-valid",
      proof: { algorithm: "sha256" },
      signature: {
        signatureId: "sig-1",
        signature: "invalid",
        algorithm: "ed25519",
        signedAt: "2026-06-03T00:00:01.000Z",
        authorityId: "unknown-authority",
        signerId: "unknown-authority",
        artifactHash: "invalid",
      },
    } as ReplayRecord;

    await writeFile(artifactPath, `${JSON.stringify(replay, null, 2)}\n`, "utf8");

    const report = await verifyArtifact(artifactPath, {
      verifyGovernance: async () => false,
      verifyBuild: () => false,
      verifyDeployment: () => false,
      verifyRuntime: () => false,
    });

    expect(typeof report.trusted).toBe("boolean");
    expect(typeof report.authority).toBe("string");
    expect(typeof report.signatureValid).toBe("boolean");
    expect(typeof report.governanceValid).toBe("boolean");
    expect(typeof report.buildValid).toBe("boolean");
    expect(typeof report.deploymentValid).toBe("boolean");
    expect(typeof report.runtimeValid).toBe("boolean");
    expect(typeof report.replayValid).toBe("boolean");
    expect(report.trusted).toBe(false);
  });
});
