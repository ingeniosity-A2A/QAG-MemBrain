import { join } from "node:path";
import { computeReplayHash } from "../../authority/persistence/replayHash.js";
import { appendJsonl } from "../shared/jsonl.js";
import { percentage } from "../shared/metrics.js";
import { RuntimeExecutionRecord } from "../types.js";

export interface ReplayIntegrityLayerResult {
  replayFidelityPercent: number;
  faithful: number;
  total: number;
}

export async function runReplayIntegrityLayer(
  outputRoot: string,
  executions: RuntimeExecutionRecord[],
): Promise<ReplayIntegrityLayerResult> {
  const outputFile = join(outputRoot, "replay-integrity-results.jsonl");
  let faithful = 0;

  for (const execution of executions) {
    const record = execution.replayRecord;
    const { replayHash, proof: _proof, signature: _signature, ...payload } = record;
    const replayedHash = computeReplayHash(payload);
    const matches = replayedHash === replayHash;

    if (matches) {
      faithful += 1;
    }

    await appendJsonl(outputFile, {
      layer: "replay_integrity",
      caseId: execution.caseId,
      replayId: record.replayId,
      originalReplayHash: replayHash,
      replayedHash,
      matches,
      timestamp: new Date().toISOString(),
    });
  }

  return {
    replayFidelityPercent: Number(percentage(faithful, executions.length).toFixed(4)),
    faithful,
    total: executions.length,
  };
}
