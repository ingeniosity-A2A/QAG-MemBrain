export interface MemoryChallenge {
  id: string;
  prompt: string;
  targetAtomId: string;
  domain: "customer-support" | "quoting" | "assembly" | "provenance" | "visual-assets";
  expectedTokens: string[];
  expectedAuthorityTokens: string[];
  expectedLineageTokens: string[];
  expectedRelationshipTokens: string[];
  minProvenanceDepth: number;
}

export interface SolverResponse {
  challengeId: string;
  answer: string;
  latencyMs: number;
  accuracy: number;
  authorityCorrectness: number;
  provenanceDepth: number;
  lineageCompleteness: number;
  relationshipAccuracy: number;
}

export interface JudgeDimensionScores {
  accuracy: number;
  authorityCorrectness: number;
  provenanceDepth: number;
  lineageCompleteness: number;
  relationshipAccuracy: number;
}

export interface SolverAggregate {
  averageScore: number;
  averageLatencyMs: number;
  dimensions: JudgeDimensionScores;
}

export interface MemoryJudgeResult {
  generatedAt: string;
  weak: SolverAggregate;
  strong: SolverAggregate;
  replaySpatial?: SolverAggregate;
  improvementPercent: JudgeDimensionScores;
  overallImprovementPercent: number;
  accepted: boolean;
}
