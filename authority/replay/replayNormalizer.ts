import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { sealReplayRecord, verifyReplayRecord } from "../persistence/replayProof.js";
import { assertReplayRecordShape } from "../persistence/replaySchemas.js";
import { ReplayRecord } from "../service/replayRecord.js";

export interface ReplayNormalizationIssue {
  line: number;
  reason: string;
}

export interface ReplayNormalizationResult {
  inputPath: string;
  outputPath: string;
  totalRows: number;
  keptRows: number;
  droppedRows: number;
  issues: ReplayNormalizationIssue[];
}

export async function normalizeReplayLedger(
  inputPath: string,
  outputPath: string,
  options?: { resign?: boolean },
): Promise<ReplayNormalizationResult> {
  const raw = await readFile(inputPath, "utf8");
  const lines = raw.split("\n");
  const kept: ReplayRecord[] = [];
  const issues: ReplayNormalizationIssue[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line.length === 0) {
      continue;
    }

    const lineNo = index + 1;

    try {
      const parsed = JSON.parse(line) as ReplayRecord;
      assertReplayRecordShape(parsed);
      if (options?.resign) {
        const { replayHash: _replayHash, proof: _proof, signature: _signature, ...unsigned } = parsed;
        kept.push(sealReplayRecord(unsigned));
        continue;
      }

      if (!verifyReplayRecord(parsed)) {
        throw new Error("replay integrity verification failed");
      }
      kept.push(parsed);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      issues.push({ line: lineNo, reason });
    }
  }

  await mkdir(dirname(outputPath), { recursive: true });
  const serialized = kept.map((row) => JSON.stringify(row)).join("\n");
  await writeFile(outputPath, `${serialized}${serialized.length > 0 ? "\n" : ""}`, "utf8");

  return {
    inputPath,
    outputPath,
    totalRows: lines.filter((line) => line.trim().length > 0).length,
    keptRows: kept.length,
    droppedRows: issues.length,
    issues,
  };
}
