import { join } from "node:path";
import { appendJsonl } from "../shared/jsonl.js";
import { percentage } from "../shared/metrics.js";
import { RuntimeExecutionRecord } from "../types.js";

export interface GovernanceLayerResult {
  governanceCoveragePercent: number;
  covered: number;
  total: number;
}

export async function runGovernanceLayer(
  outputRoot: string,
  executions: RuntimeExecutionRecord[],
): Promise<GovernanceLayerResult> {
  const outputFile = join(outputRoot, "governance-results.jsonl");
  let covered = 0;

  for (const execution of executions) {
    const record = execution.replayRecord;
    const valid =
      typeof record.governanceVersion === "string" &&
      record.governanceVersion.length > 0 &&
      typeof record.attestationHash === "string" &&
      record.attestationHash.length > 0 &&
      typeof record.governanceHash === "string" &&
      record.governanceHash.length > 0 &&
      typeof record.manifestHash === "string" &&
      record.manifestHash.length > 0 &&
      record.authorityOrder.length > 0;

    if (valid) {
      covered += 1;
    }

    await appendJsonl(outputFile, {
      layer: "governance",
      caseId: execution.caseId,
      replayId: record.replayId,
      governanceVersion: record.governanceVersion,
      governanceHash: record.governanceHash,
      manifestHash: record.manifestHash,
      attestationHash: record.attestationHash,
      authorityOrder: record.authorityOrder,
      valid,
      timestamp: new Date().toISOString(),
    });
  }

  return {
    governanceCoveragePercent: Number(percentage(covered, executions.length).toFixed(4)),
    covered,
    total: executions.length,
  };
}
