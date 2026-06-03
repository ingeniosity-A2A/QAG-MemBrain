import { join } from "node:path";
import { appendJsonl } from "../shared/jsonl.js";
import { percentage } from "../shared/metrics.js";
import { EvaluationRuntime } from "../shared/evaluationRuntime.js";
import { RuntimeExecutionRecord } from "../types.js";
import { buildJudgmentCases } from "./cases.js";

export interface JudgmentLayerResult {
  authorityEscalationScore: number;
  correct: number;
  total: number;
  executions: RuntimeExecutionRecord[];
}

export async function runJudgmentLayer(outputRoot: string): Promise<JudgmentLayerResult> {
  const outputFile = join(outputRoot, "judgment-results.jsonl");
  const runtime = new EvaluationRuntime();
  const cases = buildJudgmentCases();
  let correct = 0;
  const executions: RuntimeExecutionRecord[] = [];

  for (const evaluationCase of cases) {
    const execution = await runtime.execute(evaluationCase);
    executions.push(execution);
    const matched = execution.outcome === evaluationCase.expectedOutcome;
    if (matched) {
      correct += 1;
    }

    await appendJsonl(outputFile, {
      layer: "judgment",
      caseId: evaluationCase.id,
      prompt: evaluationCase.prompt,
      expectedOutcome: evaluationCase.expectedOutcome,
      actualOutcome: execution.outcome,
      matched,
      decisionHash: execution.decisionHash,
      replayHash: execution.replayHash,
      timestamp: new Date().toISOString(),
    });
  }

  return {
    authorityEscalationScore: Number(percentage(correct, cases.length).toFixed(4)),
    correct,
    total: cases.length,
    executions,
  };
}
