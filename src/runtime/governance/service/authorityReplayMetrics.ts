import { AuthorityReplayResult, AuthorityReplayFailureReason } from "../execution/authorityReplayResult.js";

export interface ReplayMetrics {
  totalReplays: number;
  verifiedReplays: number;
  failedReplays: number;
  hashMismatchCount: number;
  policyMismatchCount: number;
  missingMemoryReferenceCount: number;
  missingGraphReferenceCount: number;
  missingTimelineReferenceCount: number;
  missingPolicyReferenceCount: number;
  averageReplayTimeMs: number;
}

export class AuthorityReplayMetrics {
  private totalReplays = 0;
  private verifiedReplays = 0;
  private failedReplays = 0;
  private hashMismatchCount = 0;
  private policyMismatchCount = 0;
  private missingMemoryReferenceCount = 0;
  private missingGraphReferenceCount = 0;
  private missingTimelineReferenceCount = 0;
  private missingPolicyReferenceCount = 0;
  private totalReplayTimeMs = 0;

  record(result: AuthorityReplayResult, replayTimeMs: number): void {
    this.totalReplays += 1;
    this.totalReplayTimeMs += replayTimeMs;

    if (result.status === "VERIFIED") {
      this.verifiedReplays += 1;
    } else {
      this.failedReplays += 1;
    }

    this.incrementFailureCounters(result.failures);
  }

  recordReplay(replayTimeMs: number, status: "VERIFIED" | "FAILED", failures: string[]): void {
    this.record({
      decisionId: "unknown",
      lineageId: "unknown",
      hashMatch: status === "VERIFIED",
      policyMatch: status === "VERIFIED",
      referencesValid: status === "VERIFIED",
      reconstructionMatch: status === "VERIFIED",
      status,
      failures: failures as AuthorityReplayFailureReason[],
    }, replayTimeMs);
  }

  snapshot(): ReplayMetrics {
    return {
      totalReplays: this.totalReplays,
      verifiedReplays: this.verifiedReplays,
      failedReplays: this.failedReplays,
      hashMismatchCount: this.hashMismatchCount,
      policyMismatchCount: this.policyMismatchCount,
      missingMemoryReferenceCount: this.missingMemoryReferenceCount,
      missingGraphReferenceCount: this.missingGraphReferenceCount,
      missingTimelineReferenceCount: this.missingTimelineReferenceCount,
      missingPolicyReferenceCount: this.missingPolicyReferenceCount,
      averageReplayTimeMs: this.totalReplays === 0 ? 0 : this.totalReplayTimeMs / this.totalReplays,
    };
  }

  private incrementFailureCounters(failures: AuthorityReplayFailureReason[]): void {
    for (const failure of failures) {
      switch (failure) {
        case "HASH_MISMATCH":
          this.hashMismatchCount += 1;
          break;
        case "POLICY_OUTCOME_MISMATCH":
          this.policyMismatchCount += 1;
          break;
        case "MISSING_MEMORY_REFERENCE":
          this.missingMemoryReferenceCount += 1;
          break;
        case "MISSING_GRAPH_REFERENCE":
          this.missingGraphReferenceCount += 1;
          break;
        case "MISSING_TIMELINE_REFERENCE":
          this.missingTimelineReferenceCount += 1;
          break;
        case "MISSING_POLICY_REFERENCE":
          this.missingPolicyReferenceCount += 1;
          break;
        default:
          break;
      }
    }
  }
}