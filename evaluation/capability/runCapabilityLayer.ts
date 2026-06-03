import { join } from "node:path";
import { appendJsonl } from "../shared/jsonl.js";
import { computeClassificationMetrics } from "../shared/metrics.js";
import { EvaluationRuntime } from "../shared/evaluationRuntime.js";
import { CapabilitySummary, RuntimeExecutionRecord } from "../types.js";
import { buildCapabilityCases } from "./cases.js";

export interface CapabilityLayerResult {
  summary: CapabilitySummary;
  executions: RuntimeExecutionRecord[];
}

export async function runCapabilityLayer(outputRoot: string): Promise<CapabilityLayerResult> {
  const outputFile = join(outputRoot, "capability-results.jsonl");
  const runtime = new EvaluationRuntime();
  const cases = buildCapabilityCases();

  const executions: RuntimeExecutionRecord[] = [];
  let correct = 0;

  for (const evaluationCase of cases) {
    const execution = await runtime.execute(evaluationCase);
    const matched = execution.outcome === evaluationCase.expectedOutcome;
    if (matched) {
      correct += 1;
    }

    executions.push(execution);

    await appendJsonl(outputFile, {
      layer: "capability",
      caseId: evaluationCase.id,
      capability: evaluationCase.capability,
      expectedOutcome: evaluationCase.expectedOutcome,
      actualOutcome: execution.outcome,
      matched,
      decisionHash: execution.decisionHash,
      lineageHash: execution.lineageHash,
      replayHash: execution.replayHash,
      timestamp: new Date().toISOString(),
    });
  }

  const metrics = computeClassificationMetrics(correct, cases.length);

  return {
    summary: {
      accuracy: Number(metrics.accuracy.toFixed(4)),
      precision: Number(metrics.precision.toFixed(4)),
      recall: Number(metrics.recall.toFixed(4)),
      totalCases: cases.length,
      correctCases: correct,
    },
    executions,
  };
}
