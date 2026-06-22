/**
 * Arbitrator — resolves disagreements between pillars.
 *
 * Uses ConfidenceScorer to pick a winner. If confidence is too low or
 * variance is too high, escalation is required (either to FABLE for
 * System-2 planning, or to AVA007 for executive decision).
 */

import { ConfidenceScorer, type Vote, type ConfidenceScore } from './ConfidenceScorer.js';

export interface Conflict {
  /** The original question/operation being arbitrated */
  question: string;
  /** Competing votes from different pillars */
  votes: Vote[];
  /** Optional per-conflict override threshold */
  threshold?: number;
}

export interface ArbitrationDecision {
  /** 'resolved' = winner chosen; 'escalate' = needs higher authority */
  outcome: 'resolved' | 'escalate';
  /** Chosen candidate if outcome is 'resolved' */
  winner?: unknown;
  /** Final confidence score */
  confidence: ConfidenceScore;
  /** Reason for the decision */
  reason: string;
  /** Where to escalate if outcome is 'escalate' */
  escalateTo?: 'fable' | 'ava007';
}

export class Arbitrator {
  constructor(private readonly scorer: ConfidenceScorer) {}

  arbitrate(conflict: Conflict): ArbitrationDecision {
    if (conflict.votes.length === 0) {
      return {
        outcome: 'escalate',
        confidence: { score: 0, winner: undefined, variance: 0, breakdown: [] },
        reason: 'no votes cast — cannot arbitrate',
        escalateTo: 'fable',
      };
    }

    const threshold = conflict.threshold ?? this.scorer.getDefaultThreshold();
    const score = this.scorer.score(conflict.votes);

    // High variance + low score -> escalate to FABLE (System-2 planning)
    if (score.variance > 0.15 && score.score < threshold) {
      return {
        outcome: 'escalate',
        confidence: score,
        reason: `high variance (${score.variance.toFixed(3)}) and low score (${score.score.toFixed(3)}) — needs System-2 planning`,
        escalateTo: 'fable',
      };
    }

    // Below threshold but low variance -> escalate to AVA007 (executive tiebreak)
    if (score.score < threshold) {
      return {
        outcome: 'escalate',
        confidence: score,
        reason: `confidence ${score.score.toFixed(3)} below threshold ${threshold.toFixed(3)} — needs executive tiebreak`,
        escalateTo: 'ava007',
      };
    }

    return {
      outcome: 'resolved',
      winner: score.winner,
      confidence: score,
      reason: `winner chosen with confidence ${score.score.toFixed(3)} (variance ${score.variance.toFixed(3)})`,
    };
  }
}
