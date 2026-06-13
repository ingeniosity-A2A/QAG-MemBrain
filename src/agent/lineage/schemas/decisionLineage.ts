import { PolicyEvaluation, PolicyDecisionResult } from "../../policy/schemas/policyEvaluation.js";
import { ResolutionOutcome } from "../../policy/precedence/policyPrecedence.js";

export interface DecisionLineage {
  decisionId: string;
  memoryAtoms: string[];
  graphNodes: string[];
  policiesApplied: string[];
  policyEvaluations: PolicyEvaluation[];
  policyResults: PolicyDecisionResult[];
  policyEvidence: string[];
  finalPolicyOutcome: ResolutionOutcome;
  timelineEvents: string[];
  executivePlanId: string;
  decisionHash: string;
  timestamp: string;
}

export interface DecisionLineageInput {
  decisionId: string;
  memoryAtoms: string[];
  graphNodes: string[];
  policiesApplied: string[];
  policyEvaluations?: PolicyEvaluation[];
  policyResults?: PolicyDecisionResult[];
  policyEvidence?: string[];
  finalPolicyOutcome?: ResolutionOutcome;
  timelineEvents: string[];
  executivePlanId: string;
  timestamp?: string;
}

export interface LineageValidationOptions {
  existingMemoryAtoms?: Set<string>;
  existingGraphNodes?: Set<string>;
  existingPolicies?: Set<string>;
  existingTimelineEvents?: Set<string>;
}
