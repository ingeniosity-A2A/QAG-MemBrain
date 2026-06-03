import { InterpretationObservationProposal } from "../interpretation/observationProposal.js";

export type ProposalReviewOutcome = "accept" | "reject";

export interface ProposalReviewDecision {
  outcome: ProposalReviewOutcome;
  reason: string;
  reviewedAt: string;
  reviewer: "ava-007";
}

export interface ProposalReviewContext {
  minimumConfidence?: number;
  requiredEvidenceCount?: number;
}

export function reviewProposal(
  proposal: InterpretationObservationProposal,
  context: ProposalReviewContext = {},
): ProposalReviewDecision {
  const minimumConfidence = context.minimumConfidence ?? 0.8;
  const requiredEvidenceCount = context.requiredEvidenceCount ?? 2;
  const evidenceCount = proposal.derived_from.length;

  if (proposal.confidence < minimumConfidence) {
    return {
      outcome: "reject",
      reason: `confidence ${proposal.confidence} below threshold ${minimumConfidence}`,
      reviewedAt: new Date().toISOString(),
      reviewer: "ava-007",
    };
  }

  if (evidenceCount < requiredEvidenceCount) {
    return {
      outcome: "reject",
      reason: `evidence count ${evidenceCount} below threshold ${requiredEvidenceCount}`,
      reviewedAt: new Date().toISOString(),
      reviewer: "ava-007",
    };
  }

  return {
    outcome: "accept",
    reason: "proposal satisfies review thresholds",
    reviewedAt: new Date().toISOString(),
    reviewer: "ava-007",
  };
}
