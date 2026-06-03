import { join } from "node:path";
import { appendJsonl } from "../shared/jsonl.js";
import { computePercentiles } from "../shared/metrics.js";
import { RuntimeExecutionRecord } from "../types.js";

export interface OperationalLayerResult {
  decisionTime: { p50: number; p95: number; p99: number };
  lineageTime: { p50: number; p95: number; p99: number };
  replayTime: { p50: number; p95: number; p99: number };
  graphTime: { p50: number; p95: number; p99: number };
  auditTime: { p50: number; p95: number; p99: number };
}

export async function runOperationalLayer(
  outputRoot: string,
  executions: RuntimeExecutionRecord[],
): Promise<OperationalLayerResult> {
  const outputFile = join(outputRoot, "operational-results.jsonl");

  const decisionValues = executions.map((entry) => entry.metrics.decisionTime);
  const lineageValues = executions.map((entry) => entry.metrics.lineageTime);
  const replayValues = executions.map((entry) => entry.metrics.replayTime);
  const graphValues = executions.map((entry) => entry.metrics.graphTime);
  const auditValues = executions.map((entry) => entry.metrics.auditTime);

  const result: OperationalLayerResult = {
    decisionTime: computePercentiles(decisionValues),
    lineageTime: computePercentiles(lineageValues),
    replayTime: computePercentiles(replayValues),
    graphTime: computePercentiles(graphValues),
    auditTime: computePercentiles(auditValues),
  };

  await appendJsonl(outputFile, {
    layer: "operational",
    ...result,
    sampleSize: executions.length,
    timestamp: new Date().toISOString(),
  });

  return result;
}
