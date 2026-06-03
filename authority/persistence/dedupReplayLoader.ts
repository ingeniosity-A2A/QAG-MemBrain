import { readFile } from "node:fs/promises";
import { ReplayRecord } from "../service/replayRecord.js";
import { ReplayCheckpointEntry, ReplayDedupEntry, ReplayDeltaEntry } from "../replay/replayDedup.js";

export class CheckpointLoader {
  load(entries: ReplayDedupEntry[]): Map<string, ReplayCheckpointEntry> {
    const checkpoints = new Map<string, ReplayCheckpointEntry>();

    for (const entry of entries) {
      if (entry.entryType === "checkpoint") {
        checkpoints.set(entry.segmentId, entry);
      }
    }

    return checkpoints;
  }
}

export class DeltaApplier {
  apply(
    checkpoints: Map<string, ReplayCheckpointEntry>,
    entries: ReplayDedupEntry[],
  ): ReplayRecord[] {
    const records: ReplayRecord[] = [];

    for (const entry of entries) {
      if (entry.entryType !== "delta") {
        continue;
      }

      const checkpoint = checkpoints.get(entry.segmentId);
      if (!checkpoint) {
        throw new Error(`dedup replay segment '${entry.segmentId}' is missing checkpoint entry`);
      }

      records.push(reconstructReplayRecord(checkpoint, entry));
    }

    return records;
  }
}

export class DedupReplayLoader {
  constructor(
    private readonly checkpointLoader = new CheckpointLoader(),
    private readonly deltaApplier = new DeltaApplier(),
  ) {}

  async load(filePath: string): Promise<ReplayRecord[]> {
    const entries = await readDedupEntries(filePath);
    const checkpoints = this.checkpointLoader.load(entries);
    return this.deltaApplier.apply(checkpoints, entries);
  }
}

export async function readDedupEntries(filePath: string): Promise<ReplayDedupEntry[]> {
  const raw = await readFile(filePath, "utf8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as ReplayDedupEntry);
}

function reconstructReplayRecord(
  checkpoint: ReplayCheckpointEntry,
  delta: ReplayDeltaEntry,
): ReplayRecord {
  const trust = checkpoint.trust;

  return {
    replayId: delta.replayId,
    decisionId: delta.decisionId,
    lineageId: delta.lineageId,
    governanceVersion: trust.governanceVersion,
    governanceHash: trust.governanceHash,
    manifestHash: trust.manifestHash,
    attestationHash: trust.attestationHash,
    runtimeVersion: trust.runtimeVersion,
    runtimeHash: trust.runtimeHash,
    runtimeStartedAt: trust.runtimeStartedAt,
    runtimeHost: trust.runtimeHost,
    runtimeProcessId: trust.runtimeProcessId,
    runtimeNodeVersion: trust.runtimeNodeVersion,
    runtimePlatform: trust.runtimePlatform,
    gitCommit: trust.gitCommit,
    buildHash: trust.buildHash,
    buildTimestamp: trust.buildTimestamp,
    worktreeDirty: trust.worktreeDirty,
    deploymentVersion: trust.deploymentVersion,
    deploymentHash: trust.deploymentHash,
    releaseId: trust.releaseId,
    environment: trust.environment,
    status: delta.status,
    failureReasons: [...delta.failureReasons],
    authorityOrder: [...trust.authorityOrder],
    timestamp: delta.timestamp,
    startedAt: delta.startedAt,
    completedAt: delta.completedAt,
    replayHash: delta.replayHash,
    proof: trust.proof,
    signature: trust.signature,
  };
}
