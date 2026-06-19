import { ReplayRecord } from "../service/replayRecord.js";
import { AuthorityLayer } from "./replayContract.js";

export interface ReplayTrustSnapshot {
  governanceVersion: string;
  governanceHash: string;
  manifestHash: string;
  attestationHash: string;
  runtimeVersion: string;
  runtimeHash: string;
  runtimeStartedAt: string;
  runtimeHost: string;
  runtimeProcessId: number;
  runtimeNodeVersion: string;
  runtimePlatform: string;
  gitCommit: string;
  buildHash: string;
  buildTimestamp: string;
  worktreeDirty: boolean;
  deploymentVersion: string;
  deploymentHash: string;
  releaseId: string;
  environment: string;
  authorityOrder: AuthorityLayer[];
  signature: ReplayRecord["signature"];
  proof: ReplayRecord["proof"];
}

export interface ReplayCheckpointEntry {
  entryType: "checkpoint";
  segmentId: string;
  checkpointReplayId: string;
  checkpointRecordIndex: number;
  trust: ReplayTrustSnapshot;
}

export interface ReplayDeltaEntry {
  entryType: "delta";
  segmentId: string;
  replayId: string;
  decisionId: string;
  lineageId: string;
  replayHash: string;
  status: ReplayRecord["status"];
  failureReasons: string[];
  timestamp: string;
  startedAt: string;
  completedAt: string;
}

export type ReplayDedupEntry = ReplayCheckpointEntry | ReplayDeltaEntry;

export function dedupReplayRecords(records: ReplayRecord[], checkpointInterval: number): ReplayDedupEntry[] {
  if (checkpointInterval <= 0) {
    throw new Error("checkpointInterval must be > 0");
  }

  const result: ReplayDedupEntry[] = [];

  for (let start = 0; start < records.length; start += checkpointInterval) {
    const end = Math.min(records.length - 1, start + checkpointInterval - 1);
    const segmentId = `segment-${start + 1}-${end + 1}`;
    const checkpoint = records[end];

    result.push({
      entryType: "checkpoint",
      segmentId,
      checkpointReplayId: checkpoint.replayId,
      checkpointRecordIndex: end,
      trust: {
        governanceVersion: checkpoint.governanceVersion,
        governanceHash: checkpoint.governanceHash,
        manifestHash: checkpoint.manifestHash,
        attestationHash: checkpoint.attestationHash,
        runtimeVersion: checkpoint.runtimeVersion,
        runtimeHash: checkpoint.runtimeHash,
        runtimeStartedAt: checkpoint.runtimeStartedAt,
        runtimeHost: checkpoint.runtimeHost,
        runtimeProcessId: checkpoint.runtimeProcessId,
        runtimeNodeVersion: checkpoint.runtimeNodeVersion,
        runtimePlatform: checkpoint.runtimePlatform,
        gitCommit: checkpoint.gitCommit,
        buildHash: checkpoint.buildHash,
        buildTimestamp: checkpoint.buildTimestamp,
        worktreeDirty: checkpoint.worktreeDirty,
        deploymentVersion: checkpoint.deploymentVersion,
        deploymentHash: checkpoint.deploymentHash,
        releaseId: checkpoint.releaseId,
        environment: checkpoint.environment,
        authorityOrder: [...checkpoint.authorityOrder],
        signature: checkpoint.signature,
        proof: checkpoint.proof,
      },
    });

    for (let index = start; index <= end; index += 1) {
      const record = records[index];
      result.push({
        entryType: "delta",
        segmentId,
        replayId: record.replayId,
        decisionId: record.decisionId,
        lineageId: record.lineageId,
        replayHash: record.replayHash,
        status: record.status,
        failureReasons: [...record.failureReasons],
        timestamp: record.timestamp,
        startedAt: record.startedAt,
        completedAt: record.completedAt,
      });
    }
  }

  return result;
}
