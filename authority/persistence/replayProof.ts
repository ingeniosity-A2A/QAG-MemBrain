import { ReplayRecord, ReplayRecordInput } from "../service/replayRecord.js";
import { computeReplayHash } from "./replayHash.js";

export function sealReplayRecord(record: ReplayRecordInput): ReplayRecord {
  return {
    ...record,
    replayHash: computeReplayHash(record),
  };
}

export function verifyReplayRecord(record: ReplayRecord): boolean {
  const { replayHash, ...payload } = record;
  return replayHash === computeReplayHash(payload);
}