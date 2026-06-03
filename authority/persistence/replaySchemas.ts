import { ReplayRecord } from "../service/replayRecord.js";

export function assertReplayRecordShape(record: ReplayRecord): void {
  assertNonEmptyString(record.replayId, "replayId");
  assertNonEmptyString(record.decisionId, "decisionId");
  assertNonEmptyString(record.lineageId, "lineageId");
  assertNonEmptyString(record.replayHash, "replayHash");
  assertNonEmptyString(record.timestamp, "timestamp");
  assertNonEmptyString(record.startedAt, "startedAt");
  assertNonEmptyString(record.completedAt, "completedAt");

  if (record.status !== "VERIFIED" && record.status !== "FAILED") {
    throw new Error("Replay record requires status to be VERIFIED or FAILED");
  }

  if (
    !Array.isArray(record.failureReasons) ||
    record.failureReasons.some((failure) => typeof failure !== "string")
  ) {
    throw new Error("Replay record requires failureReasons to be a string array");
  }

  if (
    !Array.isArray(record.authorityOrder) ||
    record.authorityOrder.some((layer) => typeof layer !== "string" || layer.length === 0)
  ) {
    throw new Error("Replay record requires authorityOrder to be a string array");
  }
}

function assertNonEmptyString(value: string, field: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Replay record requires ${field}`);
  }
}
