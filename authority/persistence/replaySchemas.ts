import { ReplayRecord } from "../service/replayRecord.js";

export function assertReplayRecordShape(record: ReplayRecord): void {
  assertNonEmptyString(record.replayId, "replayId");
  assertNonEmptyString(record.decisionId, "decisionId");
  assertNonEmptyString(record.lineageId, "lineageId");
  assertNonEmptyString(record.startedAt, "startedAt");
  assertNonEmptyString(record.completedAt, "completedAt");

  if (record.status !== "VERIFIED" && record.status !== "FAILED") {
    throw new Error("Replay record requires status to be VERIFIED or FAILED");
  }

  if (!Array.isArray(record.failures) || record.failures.some((failure) => typeof failure !== "string")) {
    throw new Error("Replay record requires failures to be a string array");
  }
}

function assertNonEmptyString(value: string, field: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Replay record requires ${field}`);
  }
}
