export interface RuntimeSnapshot {
  runtimeVersion: string;
  runtimeHash: string;
  deploymentHash: string;
  buildHash: string;
  processId: number;
  hostname: string;
  nodeVersion: string;
  platform: string;
  startedAt: string;
}
