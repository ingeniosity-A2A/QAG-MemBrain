import { join } from "node:path";
import { computeRuntimeHash } from "../../authority/runtime/runtimeLoader.js";
import { verifyReplayRecord } from "../../authority/persistence/replayProof.js";
import { appendJsonl } from "../shared/jsonl.js";
import { percentage } from "../shared/metrics.js";
import { RuntimeExecutionRecord } from "../types.js";

export interface ProvenanceLayerResult {
  provenanceContinuityPercent: number;
  continuous: number;
  total: number;
}

export async function runProvenanceLayer(
  outputRoot: string,
  executions: RuntimeExecutionRecord[],
): Promise<ProvenanceLayerResult> {
  const outputFile = join(outputRoot, "provenance-results.jsonl");
  let continuous = 0;

  for (const execution of executions) {
    const record = execution.replayRecord;
    const replayValid = verifyReplayRecord(record);
    const expectedRuntimeHash = computeRuntimeHash(
      record.deploymentHash,
      record.runtimeProcessId,
      record.runtimeHost,
      record.runtimeStartedAt,
    );

    const runtimeValid = expectedRuntimeHash === record.runtimeHash;
    const buildValid = record.buildHash.length > 0;
    const deploymentValid = record.deploymentHash.length > 0;
    const signatureValid = record.signature.signature.length > 0;
    const continuousForRecord = replayValid && runtimeValid && buildValid && deploymentValid && signatureValid;

    if (continuousForRecord) {
      continuous += 1;
    }

    await appendJsonl(outputFile, {
      layer: "provenance",
      caseId: execution.caseId,
      replayId: record.replayId,
      replayValid,
      runtimeValid,
      buildValid,
      deploymentValid,
      signatureValid,
      continuous: continuousForRecord,
      timestamp: new Date().toISOString(),
    });
  }

  return {
    provenanceContinuityPercent: Number(percentage(continuous, executions.length).toFixed(4)),
    continuous,
    total: executions.length,
  };
}
