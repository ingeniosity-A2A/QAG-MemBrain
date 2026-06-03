import { JudgeDimensionScores, MemoryChallenge, MemoryJudgeResult, SolverAggregate, SolverResponse } from "./types.js";

export function judgeMemorySolvers(
  challenges: MemoryChallenge[],
  weak: SolverResponse[],
  strong: SolverResponse[],
  replaySpatial?: SolverResponse[],
): MemoryJudgeResult {
  const weakAggregate = aggregateSolver(challenges, weak);
  const strongAggregate = aggregateSolver(challenges, strong);
  const replaySpatialAggregate = replaySpatial ? aggregateSolver(challenges, replaySpatial) : undefined;
  const improvementPercent = computeDimensionImprovementPercent(weakAggregate.dimensions, strongAggregate.dimensions);
  const overallImprovementPercent =
    weakAggregate.averageScore === 0
      ? 100
      : ((strongAggregate.averageScore - weakAggregate.averageScore) / weakAggregate.averageScore) * 100;

  const dimensionThresholdSatisfied = Object.values(improvementPercent).every((value) => value >= 20);

  return {
    generatedAt: new Date().toISOString(),
    weak: weakAggregate,
    strong: strongAggregate,
    replaySpatial: replaySpatialAggregate,
    improvementPercent,
    overallImprovementPercent: round(overallImprovementPercent),
    accepted: dimensionThresholdSatisfied,
  };
}

function aggregateSolver(challenges: MemoryChallenge[], responses: SolverResponse[]): SolverAggregate {
  const accuracy = average(scoreTokenDimension(challenges, responses, "expectedTokens", "accuracy"));
  const authorityCorrectness = average(
    scoreTokenDimension(challenges, responses, "expectedAuthorityTokens", "authorityCorrectness"),
  );
  const lineageCompleteness = average(
    scoreTokenDimension(challenges, responses, "expectedLineageTokens", "lineageCompleteness"),
  );
  const relationshipAccuracy = average(
    scoreTokenDimension(challenges, responses, "expectedRelationshipTokens", "relationshipAccuracy"),
  );
  const provenanceDepth = average(scoreProvenanceDepth(challenges, responses));
  const averageLatencyMs = average(responses.map((response) => response.latencyMs));

  const averageScore = average([
    accuracy,
    authorityCorrectness,
    provenanceDepth,
    lineageCompleteness,
    relationshipAccuracy,
  ]);

  return {
    averageScore: round(averageScore),
    averageLatencyMs: round(averageLatencyMs),
    dimensions: {
      accuracy: round(accuracy),
      authorityCorrectness: round(authorityCorrectness),
      provenanceDepth: round(provenanceDepth),
      lineageCompleteness: round(lineageCompleteness),
      relationshipAccuracy: round(relationshipAccuracy),
    },
  };
}

function scoreTokenDimension(
  challenges: MemoryChallenge[],
  responses: SolverResponse[],
  challengeField: "expectedTokens" | "expectedAuthorityTokens" | "expectedLineageTokens" | "expectedRelationshipTokens",
  responseField:
    | "accuracy"
    | "authorityCorrectness"
    | "lineageCompleteness"
    | "relationshipAccuracy",
): number[] {
  return responses.map((response) => {
    const challenge = challenges.find((entry) => entry.id === response.challengeId);
    if (!challenge) {
      return 0;
    }

    const expectedTokens = challenge[challengeField];
    const tokenHits = expectedTokens.filter((token) => response.answer.includes(token)).length;
    const tokenScore = expectedTokens.length === 0 ? 0 : tokenHits / expectedTokens.length;
    return tokenScore * 0.6 + response[responseField] * 0.4;
  });
}

function scoreProvenanceDepth(challenges: MemoryChallenge[], responses: SolverResponse[]): number[] {
  return responses.map((response) => {
    const challenge = challenges.find((entry) => entry.id === response.challengeId);
    if (!challenge) {
      return 0;
    }

    const inferredDepth = response.answer.split("|").length;
    const depthScore = Math.min(1, inferredDepth / Math.max(challenge.minProvenanceDepth, 1));
    return depthScore * 0.6 + response.provenanceDepth * 0.4;
  });
}

function computeDimensionImprovementPercent(
  weak: JudgeDimensionScores,
  strong: JudgeDimensionScores,
): JudgeDimensionScores {
  return {
    accuracy: improvement(weak.accuracy, strong.accuracy),
    authorityCorrectness: improvement(weak.authorityCorrectness, strong.authorityCorrectness),
    provenanceDepth: improvement(weak.provenanceDepth, strong.provenanceDepth),
    lineageCompleteness: improvement(weak.lineageCompleteness, strong.lineageCompleteness),
    relationshipAccuracy: improvement(weak.relationshipAccuracy, strong.relationshipAccuracy),
  };
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

function improvement(weak: number, strong: number): number {
  if (weak === 0) {
    return 100;
  }

  return round(((strong - weak) / weak) * 100);
}
