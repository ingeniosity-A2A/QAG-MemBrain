import { AuthorityLayer } from "../../authority/replay/replayContract.js";

export interface GovernanceSnapshot {
  governanceVersion: string;
  governanceHash: string;
  manifestHash: string;
  attestationHash: string;
  authorityOrder: AuthorityLayer[];
  sourcePath: string;
  manifestPath: string;
  attestationPath: string;
  loadedAt: string;
}