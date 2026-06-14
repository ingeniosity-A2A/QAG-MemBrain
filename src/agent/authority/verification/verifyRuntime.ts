import { ReplayRecord } from "../service/replayRecord.js";
import { computeRuntimeHash } from "../runtime/runtimeLoader.js";

export function verifyRuntime(record: ReplayRecord): boolean {
  const recomputed = computeRuntimeHash(
    record.deploymentHash,
    record.runtimeProcessId,
    record.runtimeHost,
    record.runtimeStartedAt,
  );

  return recomputed === record.runtimeHash;
}
