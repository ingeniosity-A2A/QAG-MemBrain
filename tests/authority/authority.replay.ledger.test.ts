import { mkdtemp, readFile, rm } from "node:fs/promises";
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

describe("Authority replay ledger", () => {
  it("appends records without rewriting previous rows", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qag-replay-ledger-"));
    cleanupTargets.push(dir);
    const ledgerPath = join(dir, "replay.jsonl");

    await appendReplayRecord(ledgerPath, {
      replayId: "rep-1",
      decisionId: "dec-1",
      lineageId: "lin-1",
      status: "VERIFIED",
      failureReasons: [],
      authorityOrder: [...CANONICAL_AUTHORITY_ORDER],
      timestamp: "2026-06-03T20:15:01.000Z",
      startedAt: "2026-06-03T20:15:00.000Z",
      completedAt: "2026-06-03T20:15:01.000Z",
    });

    const snapshotAfterFirstAppend = await readFile(ledgerPath, "utf8");

    await appendReplayRecord(ledgerPath, {
      replayId: "rep-2",
      decisionId: "dec-2",
      lineageId: "lin-2",
      status: "FAILED",
      failureReasons: ["HASH_MISMATCH"],
      authorityOrder: [...CANONICAL_AUTHORITY_ORDER],
      timestamp: "2026-06-03T20:16:01.000Z",
      startedAt: "2026-06-03T20:16:00.000Z",
      completedAt: "2026-06-03T20:16:01.000Z",
    });

    const fullContent = await readFile(ledgerPath, "utf8");
    expect(fullContent.startsWith(snapshotAfterFirstAppend)).toBe(true);

    const records = await readReplayRecords(ledgerPath);
    expect(records).toHaveLength(2);
    expect(records[0].replayId).toBe("rep-1");
    expect(records[1].replayId).toBe("rep-2");
    expect(records[0].replayHash).not.toBe(records[1].replayHash);
  });
});
