import { ReplayRecord } from "../service/replayRecord.js";
import { loadDeploymentSnapshot } from "../deployment/deploymentLoader.js";

export function verifyDeployment(record: ReplayRecord): boolean {
  const snapshot = loadDeploymentSnapshot(record.buildHash);

  return (
    snapshot.deploymentHash === record.deploymentHash &&
    snapshot.deploymentVersion === record.deploymentVersion &&
    snapshot.releaseId === record.releaseId &&
    snapshot.environment === record.environment &&
    snapshot.buildHash === record.buildHash
  );
}
