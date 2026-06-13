import { InterpretationObservationProposal } from "../interpretation/observationProposal.js";
import { ProposalReviewDecision } from "./proposalReview.js";

export interface ProposalAuditEntry {
  auditId: string;
  proposalType: InterpretationObservationProposal["type"];
  source: InterpretationObservationProposal["source"];
  outcome: ProposalReviewDecision["outcome"];
  reason: string;
  reviewedAt: string;
  derivedFrom: string[];
  insight: string;
  confidence: number;
}

export function createProposalAudit(
  proposal: InterpretationObservationProposal,
  reviewDecision: ProposalReviewDecision,
): ProposalAuditEntry {
  return {
    auditId: `audit-${proposal.source}-${reviewDecision.reviewedAt}`,
    proposalType: proposal.type,
    source: proposal.source,
    outcome: reviewDecision.outcome,
    reason: reviewDecision.reason,
    reviewedAt: reviewDecision.reviewedAt,
    derivedFrom: [...proposal.derived_from],
    insight: proposal.insight,
    confidence: proposal.confidence,
  };
}
