import { ReplayRecord } from "../service/replayRecord.js";
import { assertSignatureRecordShape } from "../signing/signatureSchemas.js";

export function assertReplayRecordShape(record: ReplayRecord): void {
  assertNonEmptyString(record.replayId, "replayId");
  assertNonEmptyString(record.decisionId, "decisionId");
  assertNonEmptyString(record.lineageId, "lineageId");
  assertNonEmptyString(record.governanceVersion, "governanceVersion");
  assertNonEmptyString(record.governanceHash, "governanceHash");
  assertNonEmptyString(record.manifestHash, "manifestHash");
  assertNonEmptyString(record.attestationHash, "attestationHash");
  assertNonEmptyString(record.runtimeVersion, "runtimeVersion");
  assertNonEmptyString(record.runtimeHash, "runtimeHash");
  assertNonEmptyString(record.runtimeStartedAt, "runtimeStartedAt");
  assertNonEmptyString(record.runtimeHost, "runtimeHost");
  assertNonEmptyString(record.runtimeNodeVersion, "runtimeNodeVersion");
  assertNonEmptyString(record.runtimePlatform, "runtimePlatform");
  assertNonEmptyString(record.gitCommit, "gitCommit");
  assertNonEmptyString(record.buildHash, "buildHash");
  assertNonEmptyString(record.buildTimestamp, "buildTimestamp");
  assertNonEmptyString(record.deploymentVersion, "deploymentVersion");
  assertNonEmptyString(record.deploymentHash, "deploymentHash");
  assertNonEmptyString(record.releaseId, "releaseId");
  assertNonEmptyString(record.environment, "environment");
  assertNonEmptyString(record.replayHash, "replayHash");
  assertNonEmptyString(record.timestamp, "timestamp");
  assertNonEmptyString(record.startedAt, "startedAt");
  assertNonEmptyString(record.completedAt, "completedAt");

  if (record.status !== "VERIFIED" && record.status !== "FAILED") {
    throw new Error("Replay record requires status to be VERIFIED or FAILED");
  }

  if (
    !Array.isArray(record.failureReasons) ||
    record.failureReasons.some((failure) => typeof failure !== "string")
  ) {
    throw new Error("Replay record requires failureReasons to be a string array");
  }

  if (
    !Array.isArray(record.authorityOrder) ||
    record.authorityOrder.some((layer) => typeof layer !== "string" || layer.length === 0)
  ) {
    throw new Error("Replay record requires authorityOrder to be a string array");
  }

  if (!record.proof || record.proof.algorithm !== "sha256") {
    throw new Error("Replay record requires proof.algorithm to be sha256");
  }

  assertSignatureRecordShape(record.signature);

  if (typeof record.worktreeDirty !== "boolean") {
    throw new Error("Replay record requires worktreeDirty to be boolean");
  }

  if (typeof record.runtimeProcessId !== "number" || !Number.isInteger(record.runtimeProcessId)) {
    throw new Error("Replay record requires runtimeProcessId to be an integer");
  }
}

function assertNonEmptyString(value: string, field: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Replay record requires ${field}`);
  }
}
