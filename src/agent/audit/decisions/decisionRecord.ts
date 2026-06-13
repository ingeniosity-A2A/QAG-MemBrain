import { DagPathProvenance } from "../../../memory/jsonl/provenance.js";

export interface DecisionRecord {
  decisionId: string;
  memories: string[];
  policies: string[];
  relationships: string[];
  timestamp: string;
  executionPath: string[];
  lineageId?: string;
  decisionHash?: string;
  runtimeVersion?: string;
  gitCommit?: string;
  buildHash?: string;
  buildTimestamp?: string;
  worktreeDirty?: boolean;
  deploymentVersion?: string;
  deploymentHash?: string;
  runtimeHash?: string;
  runtimeStartedAt?: string;
  runtimeHost?: string;
  runtimeProcessId?: number;
  runtimeNodeVersion?: string;
  runtimePlatform?: string;
  signatureId?: string;
  signature?: string;
  signatureAlgorithm?: "ed25519";
  signatureSignedAt?: string;
  authorityId?: string;
  signerId?: string;
  signatureArtifactHash?: string;
  provenance?: DagPathProvenance;
}

export class AuditEngine {
  private readonly records: DecisionRecord[] = [];

  record(record: DecisionRecord): void {
    this.records.push(record);
  }

  append(record: DecisionRecord): void {
    this.record(record);
  }

  list(): DecisionRecord[] {
    return [...this.records];
  }
}
