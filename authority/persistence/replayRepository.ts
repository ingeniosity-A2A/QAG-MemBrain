import { appendReplayRecord, readReplayRecords } from "./replayLedger.js";
import { ReplayRecord } from "../service/replayRecord.js";

export interface ReplayRepository {
  append(record: ReplayRecord): Promise<void>;
  list(): Promise<ReplayRecord[]>;
}

export class JsonlReplayRepository implements ReplayRepository {
  constructor(private readonly filePath: string) {}

  async append(record: ReplayRecord): Promise<void> {
    await appendReplayRecord(this.filePath, record);
  }

  async list(): Promise<ReplayRecord[]> {
    return readReplayRecords(this.filePath);
  }
}
