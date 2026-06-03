import { AuthorityLayer } from "../replay/replayContract.js";
import { SignatureRecord } from "../signing/signatureRecord.js";

export interface ReplayProof {
  algorithm: "sha256";
}

export interface ReplayRecordInput {
  replayId: string;
  decisionId: string;
  lineageId: string;
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
  status: "VERIFIED" | "FAILED";
  failureReasons: string[];
  authorityOrder: AuthorityLayer[];
  timestamp: string;
  startedAt: string;
  completedAt: string;
}

export interface ReplayRecord extends ReplayRecordInput {
  replayHash: string;
  proof: ReplayProof;
  signature: SignatureRecord;
}