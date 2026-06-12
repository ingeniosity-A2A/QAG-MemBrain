import { join } from "node:path";
import { appendJsonl } from "../shared/jsonl.js";
import { EvaluationRuntime } from "../shared/evaluationRuntime.js";
import { EvaluationCase } from "../types.js";

export interface ReliabilityLayerResult {
  stability: number;
  identicalRuns: number;
  totalRuns: number;
}

export async function runReliabilityLayer(outputRoot: string): Promise<ReliabilityLayerResult> {
  const outputFile = join(outputRoot, "reliability-results.jsonl");
  const runtime = new EvaluationRuntime();

  const reliabilityCase: EvaluationCase = {
    id: "reliability-stable-001",
    capability: "orchestration",
    prompt: "Run stable orchestration plan with deterministic ordering.",
    expectedOutcome: "execute",
  };

  const runs = 10;
  const hashes: Array<{ decisionHash: string; lineageHash: string; replayHash: string }> = [];

  for (let i = 0; i < runs; i += 1) {
    const execution = await runtime.execute(reliabilityCase);
    hashes.push({
      decisionHash: execution.decisionHash,
      lineageHash: execution.lineageHash,
      replayHash: execution.replayHash,
    });

    await appendJsonl(outputFile, {
      layer: "reliability",
      iteration: i + 1,
      caseId: reliabilityCase.id,
      decisionHash: execution.decisionHash,
      lineageHash: execution.lineageHash,
      replayHash: execution.replayHash,
      timestamp: new Date().toISOString(),
    });
  }

  const baseline = hashes[0];
  const identicalRuns = hashes.filter(
    (entry) =>
      entry.decisionHash === baseline.decisionHash &&
      entry.lineageHash === baseline.lineageHash &&
      entry.replayHash === baseline.replayHash,
  ).length;

  return {
    stability: Number((identicalRuns / runs).toFixed(4)),
    identicalRuns,
    totalRuns: runs,
  };
}
