import { DecisionLineage } from "../schemas/decisionLineage.js";
import { computeDecisionHash } from "../hashing/decisionHash.js";

export function replayDecisionLineage(lineage: DecisionLineage): DecisionLineage {
  return {
    ...lineage,
    memoryAtoms: [...lineage.memoryAtoms],
    graphNodes: [...lineage.graphNodes],
    policiesApplied: [...lineage.policiesApplied],
    timelineEvents: [...lineage.timelineEvents],
  };
}

export function lineageReplayIsReproducible(lineage: DecisionLineage): boolean {
  const replayed = replayDecisionLineage(lineage);
  const hash = computeDecisionHash(replayed);
  return hash === lineage.decisionHash;
}
