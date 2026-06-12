import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendReplayRecord, readReplayRecords } from "../../authority/persistence/replayLedger.js";
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

describe("Authority replay corruption detection", () => {
  it("fails verification when persisted replay JSONL is tampered", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qag-replay-corrupt-"));
    cleanupTargets.push(dir);
    const ledgerPath = join(dir, "replay.jsonl");

    await appendReplayRecord(ledgerPath, {
      replayId: "rep-corrupt-1",
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
      runtimeProcessId: 3001,
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
      timestamp: "2026-06-03T21:00:01.000Z",
      startedAt: "2026-06-03T21:00:00.000Z",
      completedAt: "2026-06-03T21:00:01.000Z",
    });

    const original = await readReplayRecords(ledgerPath);
    expect(original).toHaveLength(1);

    const content = await readFile(ledgerPath, "utf8");
    const tampered = content.replace("\"status\":\"VERIFIED\"", "\"status\":\"FAILED\"");
    await writeFile(ledgerPath, tampered, "utf8");

    await expect(readReplayRecords(ledgerPath)).rejects.toThrow(/integrity verification failed/i);
  });
});