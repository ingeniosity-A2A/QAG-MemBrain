import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { dedupReplayRecords } from "../replay/replayDedup.js";
import { appendReplayRecord, readReplayRecords } from "./replayLedger.js";
import { DedupReplayLoader } from "./dedupReplayLoader.js";
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

export class NativeDedupReplayRepository implements ReplayRepository {
  private readonly dedupLoader = new DedupReplayLoader();

  constructor(
    private readonly filePath: string,
    private readonly dedupFilePath: string,
    private readonly checkpointInterval = 5000,
  ) {}

  async append(record: ReplayRecordInput): Promise<void> {
    await appendReplayRecord(this.filePath, record);
    const records = await readReplayRecords(this.filePath);
    const dedupEntries = dedupReplayRecords(records, this.checkpointInterval);
    await mkdir(dirname(this.dedupFilePath), { recursive: true });
    const content = dedupEntries.map((entry) => JSON.stringify(entry)).join("\n");
    await writeFile(this.dedupFilePath, `${content}${content.length > 0 ? "\n" : ""}`, "utf8");
  }

  async list(): Promise<ReplayRecord[]> {
    if (existsSync(this.dedupFilePath)) {
      return this.dedupLoader.load(this.dedupFilePath);
    }

    return readReplayRecords(this.filePath);
  }
}
