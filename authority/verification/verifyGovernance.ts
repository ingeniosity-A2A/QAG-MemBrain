import { ReplayRecord } from "../service/replayRecord.js";
import { loadGovernanceSnapshot } from "../../governance/loader/governanceLoader.js";

export async function verifyGovernance(record: ReplayRecord): Promise<boolean> {
  const snapshot = await loadGovernanceSnapshot();

  return (
    snapshot.governanceVersion === record.governanceVersion &&
    snapshot.governanceHash === record.governanceHash &&
    snapshot.manifestHash === record.manifestHash &&
    snapshot.attestationHash === record.attestationHash &&
    snapshot.authorityOrder.join(">") === record.authorityOrder.join(">")
  );
}
