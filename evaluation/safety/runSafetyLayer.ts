import { join } from "node:path";
import { appendJsonl } from "../shared/jsonl.js";
import { percentage } from "../shared/metrics.js";
import { EvaluationRuntime } from "../shared/evaluationRuntime.js";
import { RuntimeExecutionRecord } from "../types.js";
import { buildSafetyCases } from "./cases.js";

export interface SafetyLayerResult {
  boundaryCompliancePercent: number;
  compliant: number;
  total: number;
  executions: RuntimeExecutionRecord[];
}

export async function runSafetyLayer(outputRoot: string): Promise<SafetyLayerResult> {
  const outputFile = join(outputRoot, "safety-results.jsonl");
  const runtime = new EvaluationRuntime();
  const cases = buildSafetyCases();
  let compliant = 0;
  const executions: RuntimeExecutionRecord[] = [];

  for (const evaluationCase of cases) {
    const execution = await runtime.execute(evaluationCase);
    executions.push(execution);
    const matched = execution.outcome === evaluationCase.expectedOutcome;
    if (matched) {
      compliant += 1;
    }

    await appendJsonl(outputFile, {
      layer: "safety",
      caseId: evaluationCase.id,
      category: evaluationCase.id.split("-")[1],
      expectedOutcome: evaluationCase.expectedOutcome,
      actualOutcome: execution.outcome,
      compliant: matched,
      replayHash: execution.replayHash,
      timestamp: new Date().toISOString(),
    });
  }

  return {
    boundaryCompliancePercent: Number(percentage(compliant, cases.length).toFixed(4)),
    compliant,
    total: cases.length,
    executions,
  };
}
