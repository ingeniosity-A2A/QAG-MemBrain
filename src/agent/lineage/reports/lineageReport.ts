import { DecisionLineage } from "../schemas/decisionLineage.js";

export function buildLineageReport(lineage: DecisionLineage): Record<string, unknown> {
  return {
    decisionId: lineage.decisionId,
    timestamp: lineage.timestamp,
    decisionHash: lineage.decisionHash,
    memoryAtoms: [...lineage.memoryAtoms],
    graphNodes: [...lineage.graphNodes],
    policiesApplied: [...lineage.policiesApplied],
    timelineEvents: [...lineage.timelineEvents],
    executivePlanId: lineage.executivePlanId,
  };
}
