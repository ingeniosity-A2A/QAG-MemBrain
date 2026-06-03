export interface DeploymentSnapshot {
  deploymentVersion: string;
  deploymentHash: string;
  releaseId: string;
  environment: string;
  buildHash: string;
  containerHash: string;
  deployedAt: string;
  manifestPath: string;
  loadedAt: string;
}