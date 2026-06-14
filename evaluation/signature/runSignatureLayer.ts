import { join } from "node:path";
import { verifyReplayRecord } from "../../authority/persistence/replayProof.js";
import { appendJsonl } from "../shared/jsonl.js";
import { percentage } from "../shared/metrics.js";
import { RuntimeExecutionRecord } from "../types.js";

export interface SignatureLayerResult {
  signatureVerificationRate: number;
  verified: number;
  total: number;
}

export async function runSignatureLayer(
  outputRoot: string,
  executions: RuntimeExecutionRecord[],
): Promise<SignatureLayerResult> {
  const outputFile = join(outputRoot, "signature-results.jsonl");
  let verified = 0;

  for (const execution of executions) {
    const valid = verifyReplayRecord(execution.replayRecord);
    if (valid) {
      verified += 1;
    }

    await appendJsonl(outputFile, {
      layer: "signature",
      caseId: execution.caseId,
      replayId: execution.replayRecord.replayId,
      signatureId: execution.replayRecord.signature.signatureId,
      signerId: execution.replayRecord.signature.signerId,
      valid,
      timestamp: new Date().toISOString(),
    });
  }

  return {
    signatureVerificationRate: Number(percentage(verified, executions.length).toFixed(4)),
    verified,
    total: executions.length,
  };
}
