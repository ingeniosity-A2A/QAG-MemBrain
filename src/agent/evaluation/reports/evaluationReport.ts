import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { EvaluationReport } from "../types.js";
import { hashJson, signEvaluationHash } from "../shared/signing.js";
import { writeJson } from "../shared/jsonl.js";

export interface SignedReportArtifact {
  reportPath: string;
  hashPath: string;
  signaturePath: string;
  reportHash: string;
}

export async function writeSignedEvaluationReport(
  outputRoot: string,
  report: EvaluationReport,
): Promise<SignedReportArtifact> {
  const reportPath = join(outputRoot, "evaluation-report.json");
  const hashPath = join(outputRoot, "evaluation-report.hash");
  const signaturePath = join(outputRoot, "evaluation-report.signature");

  await writeJson(reportPath, report);

  const reportHash = hashJson(report);
  await writeFile(hashPath, `${reportHash}\n`, "utf8");

  const signature = signEvaluationHash(reportHash);
  await writeJson(signaturePath, signature);

  return {
    reportPath,
    hashPath,
    signaturePath,
    reportHash,
  };
}
