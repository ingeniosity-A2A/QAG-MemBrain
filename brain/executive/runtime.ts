import { AuditEngine } from "../../audit/decisions/decisionRecord.js";
import { DecisionLineageEngine } from "../../lineage/engine/decisionLineageEngine.js";
import { DecisionLineage } from "../../lineage/schemas/decisionLineage.js";

export interface ExecutiveRuntime {
  plan(goal: string, context: Record<string, unknown>): Promise<string[]>;
  orchestrate(planSteps: string[]): Promise<void>;
}

export class BasicExecutiveRuntime implements ExecutiveRuntime {
  constructor(
    private readonly audit?: AuditEngine,
    private readonly lineageEngine: DecisionLineageEngine = new DecisionLineageEngine(),
  ) {}

  async plan(goal: string, context: Record<string, unknown>): Promise<string[]> {
    const steps: string[] = [
      `goal:${goal}`,
      "memory_lookup",
      "graph_context",
      "decision_draft",
    ];

    const relatedNodeIds = this.extractRelatedNodeIds(context);
    if (relatedNodeIds.length > 0) {
      steps.push("relationship_reasoning");
    }

    steps.push("audit_record");
    return steps;
  }

  async orchestrate(_planSteps: string[]): Promise<void> {
    return Promise.resolve();
  }

  recordDecision(
    decisionId: string,
    memories: string[],
    relationships: string[],
    executionPath: string[] = ["reflex", "executive"],
    policies: string[] = [],
  ): void {
    if (!this.audit) {
      return;
    }

    this.audit.record({
      decisionId,
      memories,
      policies,
      relationships,
      timestamp: new Date().toISOString(),
      executionPath,
    });
  }

  recordDecisionWithLineage(input: {
    decisionId: string;
    memoryAtoms: string[];
    graphNodes: string[];
    policiesApplied: string[];
    timelineEvents: string[];
    executivePlanId: string;
    executionPath?: string[];
  }): DecisionLineage {
    const lineage = this.lineageEngine.createLineage({
      decisionId: input.decisionId,
      memoryAtoms: input.memoryAtoms,
      graphNodes: input.graphNodes,
      policiesApplied: input.policiesApplied,
      timelineEvents: input.timelineEvents,
      executivePlanId: input.executivePlanId,
    });

    if (this.audit) {
      this.audit.record({
        decisionId: lineage.decisionId,
        memories: [...lineage.memoryAtoms],
        policies: [...lineage.policiesApplied],
        relationships: [...lineage.graphNodes],
        timestamp: lineage.timestamp,
        executionPath: input.executionPath ?? ["reflex", "executive"],
        lineageId: lineage.decisionId,
        decisionHash: lineage.decisionHash,
      });
    }

    return lineage;
  }

  private extractRelatedNodeIds(context: Record<string, unknown>): string[] {
    const graphContext = context.graphContext as { relatedNodeIds?: unknown } | undefined;
    if (!graphContext || !Array.isArray(graphContext.relatedNodeIds)) {
      return [];
    }

    return graphContext.relatedNodeIds.filter((value): value is string => typeof value === "string");
  }
}
