/**
 * ConfidenceScorer — multi-agent voting + uncertainty quantification.
 *
 * Used by the Arbitrator to resolve disagreements between REV.IKE,
 * FABLE, GOOSE, etc.
 *
 * Scoring model:
 *   final = weighted_average(votes) - penalty(vote_variance)
 * where weights come from per-agent reputation (stored in DuckDB
 * governance store, fallback to equal weights).
 */

export interface Vote {
  agent: string;            // e.g. 'rev_ike', 'fable', 'goose'
  candidate: unknown;       // The proposed answer/action
  confidence: number;       // 0.0 to 1.0 — agent's own self-confidence
  rationale?: string;
}

export interface ConfidenceScore {
  /** Final aggregated confidence, 0.0 to 1.0 */
  score: number;
  /** Winning candidate (the one with highest weighted confidence) */
  winner: unknown;
  /** Variance across votes — high variance triggers arbitration */
  variance: number;
  /** Per-agent breakdown */
  breakdown: Array<{ agent: string; weighted: number; confidence: number; weight: number }>;
}

export class ConfidenceScorer {
  /** agent -> weight, defaults to 1.0 */
  private reputation: Map<string, number> = new Map();
  /** Default threshold for "confident enough" — below this triggers arbitration */
  private defaultThreshold = 0.7;

  setReputation(agent: string, weight: number): void {
    if (weight < 0) throw new Error('reputation weight must be >= 0');
    this.reputation.set(agent, weight);
  }

  getReputation(agent: string): number {
    return this.reputation.get(agent) ?? 1.0;
  }

  setDefaultThreshold(t: number): void {
    if (t < 0 || t > 1) throw new Error('threshold must be in [0, 1]');
    this.defaultThreshold = t;
  }

  getDefaultThreshold(): number {
    return this.defaultThreshold;
  }

  /** Aggregate votes into a single confidence score. */
  score(votes: Vote[]): ConfidenceScore {
    if (votes.length === 0) {
      return { score: 0, winner: undefined, variance: 0, breakdown: [] };
    }

    // Group by candidate (using JSON serialization for equality)
    const groups = new Map<string, { candidate: unknown; weightedSum: number; weightSum: number; confidences: number[]; agents: string[] }>();
    for (const v of votes) {
      const key = stableStringify(v.candidate);
      const w = this.getReputation(v.agent);
      const group = groups.get(key) ?? {
        candidate: v.candidate,
        weightedSum: 0,
        weightSum: 0,
        confidences: [],
        agents: [],
      };
      group.weightedSum += v.confidence * w;
      group.weightSum += w;
      group.confidences.push(v.confidence);
      group.agents.push(v.agent);
      groups.set(key, group);
    }

    // Pick the group with the highest weighted average confidence
    let best: { candidate: unknown; weighted: number; agents: string[]; confidences: number[] } | null = null;
    const breakdown: ConfidenceScore['breakdown'] = [];
    for (const v of votes) {
      const w = this.getReputation(v.agent);
      breakdown.push({ agent: v.agent, confidence: v.confidence, weight: w, weighted: v.confidence * w });
    }
    for (const g of groups.values()) {
      const weighted = g.weightedSum / g.weightSum;
      if (!best || weighted > best.weighted) {
        best = { candidate: g.candidate, weighted, agents: g.agents, confidences: g.confidences };
      }
    }

    // Variance across all vote confidences (not just winning group)
    const allConfs = votes.map(v => v.confidence);
    const mean = allConfs.reduce((a, b) => a + b, 0) / allConfs.length;
    const variance = allConfs.length > 1
      ? allConfs.reduce((a, b) => a + (b - mean) ** 2, 0) / allConfs.length
      : 0;

    // Penalty: high variance -> lower final score
    const penalty = Math.min(0.3, variance * 0.5);
    const finalScore = Math.max(0, (best?.weighted ?? 0) - penalty);

    return {
      score: finalScore,
      winner: best?.candidate,
      variance,
      breakdown,
    };
  }

  /** Convenience: returns true if score >= threshold. */
  isConfident(score: ConfidenceScore, threshold: number = this.defaultThreshold): boolean {
    return score.score >= threshold;
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const keys = Object.keys(value as object).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify((value as Record<string, unknown>)[k])).join(',') + '}';
}
