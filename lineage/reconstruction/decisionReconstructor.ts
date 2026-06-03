import { computeDecisionHash } from "../hashing/decisionHash.js";
import { DecisionLineage } from "../schemas/decisionLineage.js";

export interface ReconstructionResult {
  decisionId: string;
  originalHash: string;
  reconstructedHash: string;
  hashMatch: boolean;
  memoryLoaded: number;
  graphLoaded: number;
  policiesLoaded: number;
  timelineLoaded: number;
}

export interface ReconstructionDependencies {
  loadLineage(decisionId: string): Promise<DecisionLineage | null>;
  loadMemoryAtom(memoryAtomId: string): Promise<unknown | null>;
  loadGraphNode(graphNodeId: string): Promise<unknown | null>;
  loadPolicy(policyId: string): Promise<unknown | null>;
  loadTimelineEvent(eventId: string): Promise<unknown | null>;
}

export class DecisionReconstructor {
  async reconstruct(decisionId: string, deps: ReconstructionDependencies): Promise<ReconstructionResult> {
    const lineage = await deps.loadLineage(decisionId);
    if (!lineage) {
      throw new Error(`Lineage for decision '${decisionId}' was not found`);
    }

    const [memoryLoaded, graphLoaded, policiesLoaded, timelineLoaded] = await Promise.all([
      this.countLoaded(lineage.memoryAtoms, deps.loadMemoryAtom),
      this.countLoaded(lineage.graphNodes, deps.loadGraphNode),
      this.countLoaded(lineage.policiesApplied, deps.loadPolicy),
      this.countLoaded(lineage.timelineEvents, deps.loadTimelineEvent),
    ]);

    const reconstructedHash = computeDecisionHash({
      decisionId: lineage.decisionId,
      memoryAtoms: lineage.memoryAtoms,
      graphNodes: lineage.graphNodes,
      policiesApplied: lineage.policiesApplied,
      timelineEvents: lineage.timelineEvents,
      executivePlanId: lineage.executivePlanId,
      timestamp: lineage.timestamp,
    });

    return {
      decisionId: lineage.decisionId,
      originalHash: lineage.decisionHash,
      reconstructedHash,
      hashMatch: lineage.decisionHash === reconstructedHash,
      memoryLoaded,
      graphLoaded,
      policiesLoaded,
      timelineLoaded,
    };
  }

  private async countLoaded(
    ids: string[],
    loader: (id: string) => Promise<unknown | null>,
  ): Promise<number> {
    let loaded = 0;

    for (const id of ids) {
      const value = await loader(id);
      if (value !== null) {
        loaded += 1;
      }
    }

    return loaded;
  }
}
