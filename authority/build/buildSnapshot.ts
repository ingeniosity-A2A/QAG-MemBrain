export interface BuildSnapshot {
  runtimeVersion: string;
  gitCommit: string;
  buildHash: string;
  buildTimestamp: string;
  worktreeDirty: boolean;
  manifestPath: string;
  loadedAt: string;
}