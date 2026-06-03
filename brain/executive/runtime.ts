import { AuditEngine } from "../../audit/decisions/decisionRecord.js";

export interface ExecutiveRuntime {
  plan(goal: string, context: Record<string, unknown>): Promise<string[]>;
  orchestrate(planSteps: string[]): Promise<void>;
}

export class BasicExecutiveRuntime implements ExecutiveRuntime {
  constructor(private readonly audit?: AuditEngine) {}

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

  private extractRelatedNodeIds(context: Record<string, unknown>): string[] {
    const graphContext = context.graphContext as { relatedNodeIds?: unknown } | undefined;
    if (!graphContext || !Array.isArray(graphContext.relatedNodeIds)) {
      return [];
    }

    return graphContext.relatedNodeIds.filter((value): value is string => typeof value === "string");
  }
}
