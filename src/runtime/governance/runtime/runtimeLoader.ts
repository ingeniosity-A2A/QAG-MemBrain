import { createHash } from "node:crypto";
import { hostname as readHostname } from "node:os";
import { RuntimeSnapshot } from "./runtimeSnapshot.js";

let cachedRuntimeSnapshot: RuntimeSnapshot | null = null;

interface RuntimeSnapshotInput {
  runtimeVersion: string;
  deploymentHash: string;
  buildHash: string;
}

export function loadRuntimeSnapshot(input: RuntimeSnapshotInput): RuntimeSnapshot {
  if (cachedRuntimeSnapshot) {
    return cachedRuntimeSnapshot;
  }

  const processId = process.pid;
  const host = readHostname();
  const startedAt = new Date().toISOString();
  const runtimeHash = computeRuntimeHash(input.deploymentHash, processId, host, startedAt);

  cachedRuntimeSnapshot = {
    runtimeVersion: input.runtimeVersion,
    runtimeHash,
    deploymentHash: input.deploymentHash,
    buildHash: input.buildHash,
    processId,
    hostname: host,
    nodeVersion: process.version,
    platform: process.platform,
    startedAt,
  };

  return cachedRuntimeSnapshot;
}

export function computeRuntimeHash(
  deploymentHash: string,
  processId: number,
  host: string,
  startedAt: string,
): string {
  return createHash("sha256").update(`${deploymentHash}${processId}${host}${startedAt}`).digest("hex");
}

export function resetRuntimeSnapshotForTests(): void {
  cachedRuntimeSnapshot = null;
}
