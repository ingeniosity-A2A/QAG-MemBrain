import { PolicyEvaluation } from "../schemas/policyEvaluation.js";

export function buildPolicyReport(evaluations: PolicyEvaluation[]): Record<string, unknown> {
  return {
    evaluatedAt: new Date().toISOString(),
    evaluations: evaluations.map((evaluation) => ({
      policyId: evaluation.policyId,
      result: evaluation.result,
      reason: evaluation.reason,
      evidence: [...evaluation.evidence],
      timestamp: evaluation.timestamp,
    })),
  };
}
