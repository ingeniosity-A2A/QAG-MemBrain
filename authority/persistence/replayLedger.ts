import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { ReplayRecord, ReplayRecordInput } from "../service/replayRecord.js";
import { assertReplayRecordShape } from "./replaySchemas.js";
import { sealReplayRecord, verifyReplayRecord } from "./replayProof.js";

export async function appendReplayRecord(filePath: string, record: ReplayRecordInput): Promise<void> {
  const sealed = sealReplayRecord(record);
  assertReplayRecordShape(sealed);
  await mkdir(dirname(filePath), { recursive: true });
  await appendFile(filePath, `${JSON.stringify(sealed)}\n`, "utf8");
}

export async function readReplayRecords(filePath: string): Promise<ReplayRecord[]> {
  try {
    const content = await readFile(filePath, "utf8");
    const lines = content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    return lines.map((line) => {
      const parsed = JSON.parse(line) as ReplayRecord;
      assertReplayRecordShape(parsed);
      if (!verifyReplayRecord(parsed)) {
        throw new Error(`Replay record integrity verification failed for replayId '${parsed.replayId}'`);
      }
      return parsed;
    });
  } catch (error) {
    const maybeCode = (error as { code?: string }).code;
    if (maybeCode === "ENOENT") {
      return [];
    }

    throw error;
  }
}
