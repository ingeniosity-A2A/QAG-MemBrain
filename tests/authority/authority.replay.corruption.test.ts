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