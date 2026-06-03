import { AuthorityReplayRecord } from "./replayContract.js";
import { ReplayValidationResult } from "./replayValidator.js";

export interface AuthorityReplayReport {
  decisionId: string;
  lineageId: string;
  hashMatch: boolean;
  policyMatch: boolean;
  referencesValid: boolean;
  authorityOrderValid: boolean;
  reconstructionMatch: boolean;
  status: "VERIFIED" | "FAILED";
  timestamp: string;
  issues: string[];
}

export function buildReplayReport(
  record: AuthorityReplayRecord,
  validation: ReplayValidationResult,
): AuthorityReplayReport {
  return {
    decisionId: record.decisionId,
    lineageId: record.lineageId,
    hashMatch: validation.hashMatch,
    policyMatch: validation.policyMatch,
    referencesValid: validation.referencesValid,
    authorityOrderValid: validation.authorityOrderValid,
    reconstructionMatch: validation.reconstructionMatch,
    status: validation.status,
    timestamp: record.timestamp,
    issues: [...validation.issues],
  };
}
