import { ReplayRecord } from "../service/replayRecord.js";
import { loadBuildSnapshot } from "../build/buildLoader.js";

export function verifyBuild(record: ReplayRecord): boolean {
  const snapshot = loadBuildSnapshot();

  return (
    snapshot.buildHash === record.buildHash &&
    snapshot.runtimeVersion === record.runtimeVersion &&
    snapshot.gitCommit === record.gitCommit &&
    snapshot.buildTimestamp === record.buildTimestamp &&
    snapshot.worktreeDirty === record.worktreeDirty
  );
}
