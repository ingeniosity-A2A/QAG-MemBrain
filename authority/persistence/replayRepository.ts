import { appendReplayRecord, readReplayRecords } from "./replayLedger.js";
import { ReplayRecord, ReplayRecordInput } from "../service/replayRecord.js";

export interface ReplayRepository {
  append(record: ReplayRecordInput): Promise<void>;
  list(): Promise<ReplayRecord[]>;
}

export class JsonlReplayRepository implements ReplayRepository {
  constructor(private readonly filePath: string) {}

  async append(record: ReplayRecordInput): Promise<void> {
    await appendReplayRecord(this.filePath, record);
  }

  async list(): Promise<ReplayRecord[]> {
    return readReplayRecords(this.filePath);
  }
}
