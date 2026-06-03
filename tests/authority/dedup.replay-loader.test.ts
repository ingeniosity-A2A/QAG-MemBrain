import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DedupReplayLoader } from "../../authority/persistence/dedupReplayLoader.js";

const cleanupTargets: string[] = [];

afterEach(async () => {
  while (cleanupTargets.length > 0) {
    const target = cleanupTargets.pop();
    if (target) {
      await rm(target, { recursive: true, force: true });
    }
  }
});

describe("Dedup replay loader", () => {
  it("reconstructs replay records from checkpoint and delta entries", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qag-dedup-loader-"));
    cleanupTargets.push(dir);

    const dedupPath = join(dir, "replay.dedup.jsonl");
    const lines = [
      JSON.stringify({
        entryType: "checkpoint",
        segmentId: "segment-1-2",
        checkpointReplayId: "rep-2",
        checkpointRecordIndex: 1,
        trust: {
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
          authorityOrder: ["JSONL", "Tashi", "Neo4j", "GSAP", "Runtime"],
          signature: {
            signatureId: "sig-2",
            signature: "invalid",
            algorithm: "ed25519",
            signedAt: "2026-06-03T00:00:01.000Z",
            authorityId: "ava007-authority-v2",
            signerId: "ava007-authority-v2",
            artifactHash: "artifact-hash",
          },
          proof: {
            algorithm: "sha256",
          },
        },
      }),
      JSON.stringify({
        entryType: "delta",
        segmentId: "segment-1-2",
        replayId: "rep-1",
        decisionId: "decision-1",
        lineageId: "lineage-1",
        replayHash: "replay-hash-1",
        status: "VERIFIED",
        failureReasons: [],
        timestamp: "2026-06-03T00:00:01.000Z",
        startedAt: "2026-06-03T00:00:00.000Z",
        completedAt: "2026-06-03T00:00:01.000Z",
      }),
      JSON.stringify({
        entryType: "delta",
        segmentId: "segment-1-2",
        replayId: "rep-2",
        decisionId: "decision-2",
        lineageId: "lineage-2",
        replayHash: "replay-hash-2",
        status: "VERIFIED",
        failureReasons: [],
        timestamp: "2026-06-03T00:00:02.000Z",
        startedAt: "2026-06-03T00:00:01.000Z",
        completedAt: "2026-06-03T00:00:02.000Z",
      }),
    ];

    await writeFile(dedupPath, `${lines.join("\n")}\n`, "utf8");

    const loader = new DedupReplayLoader();
    const records = await loader.load(dedupPath);

    expect(records).toHaveLength(2);
    expect(records[0].governanceVersion).toBe("1.5");
    expect(records[0].replayId).toBe("rep-1");
    expect(records[1].replayId).toBe("rep-2");
    expect(records[1].signature.signerId).toBe("ava007-authority-v2");
  });
});
