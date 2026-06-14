export type PolicyDecisionResult = "allow" | "deny" | "advisory";

export interface PolicyEvaluation {
  policyId: string;
  result: PolicyDecisionResult;
  reason: string;
  evidence: string[];
  timestamp: string;
}

export interface PolicyRequestContext {
  memoryContext?: string[];
  graphContext?: string[];
  timelineContext?: string[];
  request?: string;
}
