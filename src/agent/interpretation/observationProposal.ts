import { MemoryReflection } from "./memoryReflection.js";

export interface InterpretationObservationProposal {
  type: "observation";
  source: "rev_ike_lens";
  derived_from: string[];
  insight: string;
  confidence: number;
  observationCount: number;
  graphHash: string;
}

export function proposeObservationMemory(reflection: MemoryReflection): InterpretationObservationProposal {
  const insight = reflection.insights[0]?.statement ?? "No insight available";
  const confidence = clampConfidence(
    average([
      reflection.ledgerCount > 0 ? 0.85 : 0,
      reflection.replayCount > 0 ? 0.85 : 0,
      reflection.graphNodeCount > 0 ? 0.85 : 0,
      reflection.graphRelationshipCount > 0 ? 0.85 : 0,
    ]),
  );

  return {
    type: "observation",
    source: "rev_ike_lens",
    derived_from: [...reflection.insights.map((insightItem) => insightItem.insightId), ...reflection.patterns.map((pattern) => pattern.patternId)],
    insight,
    confidence,
    observationCount: reflection.observations.length,
    graphHash: reflection.graphHash,
  };
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clampConfidence(value: number): number {
  return Number(Math.min(1, Math.max(0, value)).toFixed(3));
}
