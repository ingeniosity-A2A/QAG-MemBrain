import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendReplayRecord } from "../../authority/persistence/replayLedger.js";
import { normalizeReplayLedger } from "../../authority/replay/replayNormalizer.js";
import { CANONICAL_AUTHORITY_ORDER } from "../../authority/replay/replayContract.js";

const cleanupTargets: string[] = [];

afterEach(async () => {
  while (cleanupTargets.length > 0) {
    const path = cleanupTargets.pop();
    if (path) {
      await rm(path, { recursive: true, force: true });
    }
  }
});

describe("Replay ledger normalization", () => {
  it("keeps only valid fully signed rows and drops malformed rows", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qag-replay-normalizer-"));
    cleanupTargets.push(dir);

    const sourcePath = join(dir, "replay.jsonl");
    const normalizedPath = join(dir, "replay-v3.jsonl");

    await appendReplayRecord(sourcePath, {
      replayId: "rep-1",
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
      runtimeProcessId: 2001,
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
      timestamp: "2026-06-03T20:15:01.000Z",
      startedAt: "2026-06-03T20:15:00.000Z",
      completedAt: "2026-06-03T20:15:01.000Z",
    });

    await appendFile(sourcePath, `${JSON.stringify({ replayId: "legacy-row" })}\n`, "utf8");

    const result = await normalizeReplayLedger(sourcePath, normalizedPath);
    expect(result.totalRows).toBe(2);
    expect(result.keptRows).toBe(1);
    expect(result.droppedRows).toBe(1);

    const outputLines = (await readFile(normalizedPath, "utf8"))
      .trim()
      .split("\n")
      .filter((line) => line.length > 0);

    expect(outputLines).toHaveLength(1);
  });
});
