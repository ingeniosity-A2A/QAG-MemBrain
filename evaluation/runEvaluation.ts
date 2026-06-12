import { rm } from "node:fs/promises";
import { join } from "node:path";
import { runCapabilityLayer } from "./capability/runCapabilityLayer.js";
import { runReliabilityLayer } from "./reliability/runReliabilityLayer.js";
import { runGovernanceLayer } from "./governance/runGovernanceLayer.js";
import { runProvenanceLayer } from "./provenance/runProvenanceLayer.js";
import { runJudgmentLayer } from "./judgment/runJudgmentLayer.js";
import { runSafetyLayer } from "./safety/runSafetyLayer.js";
import { runReplayIntegrityLayer } from "./replayIntegrity/runReplayIntegrityLayer.js";
import { runSignatureLayer } from "./signature/runSignatureLayer.js";
import { runOperationalLayer } from "./operational/runOperationalLayer.js";
import { writeSignedEvaluationReport } from "./reports/evaluationReport.js";
import { EvaluationReport } from "./types.js";

const JSONL_OUTPUT_FILES = [
  "capability-results.jsonl",
  "reliability-results.jsonl",
  "governance-results.jsonl",
  "provenance-results.jsonl",
  "judgment-results.jsonl",
  "safety-results.jsonl",
  "replay-integrity-results.jsonl",
  "signature-results.jsonl",
  "operational-results.jsonl",
];

async function cleanupOutputs(outputRoot: string): Promise<void> {
  for (const fileName of JSONL_OUTPUT_FILES) {
    await rm(join(outputRoot, fileName), { force: true });
  }

  await rm(join(outputRoot, "evaluation-report.json"), { force: true });
  await rm(join(outputRoot, "evaluation-report.hash"), { force: true });
  await rm(join(outputRoot, "evaluation-report.signature"), { force: true });
}

export async function runEvaluation(outputRoot = join(process.cwd(), "evaluation")): Promise<EvaluationReport> {
  await cleanupOutputs(outputRoot);

  const capability = await runCapabilityLayer(outputRoot);
  const reliability = await runReliabilityLayer(outputRoot);
  const judgment = await runJudgmentLayer(outputRoot);
  const safety = await runSafetyLayer(outputRoot);

  const allExecutions = [...capability.executions, ...judgment.executions, ...safety.executions];

  const governance = await runGovernanceLayer(outputRoot, allExecutions);
  const provenance = await runProvenanceLayer(outputRoot, allExecutions);
  const replayIntegrity = await runReplayIntegrityLayer(outputRoot, allExecutions);
  const signature = await runSignatureLayer(outputRoot, allExecutions);
  const operational = await runOperationalLayer(outputRoot, allExecutions);

  const report: EvaluationReport = {
    generatedAt: new Date().toISOString(),
    totals: {
      decisionsEvaluated: allExecutions.length,
    },
    capability: capability.summary,
    reliability,
    governance,
    provenance,
    judgment: {
      authorityEscalationScore: judgment.authorityEscalationScore,
      correct: judgment.correct,
      total: judgment.total,
    },
    safety: {
      boundaryCompliancePercent: safety.boundaryCompliancePercent,
      compliant: safety.compliant,
      total: safety.total,
    },
    replayIntegrity,
    signature,
    operational,
  };

  await writeSignedEvaluationReport(outputRoot, report);

  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runEvaluation()
    .then((report) => {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.stack ?? error.message : String(error);
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    });
}
