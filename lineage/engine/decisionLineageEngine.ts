import {
  DecisionLineage,
  DecisionLineageInput,
  LineageValidationOptions,
} from "../schemas/decisionLineage.js";
import { computeDecisionHash } from "../hashing/decisionHash.js";

export class DecisionLineageEngine {
  createLineage(
    input: DecisionLineageInput,
    validationOptions: LineageValidationOptions = {},
  ): DecisionLineage {
    this.assertInput(input);
    this.assertReferences(input, validationOptions);

    return {
      decisionId: input.decisionId,
      memoryAtoms: [...input.memoryAtoms],
      graphNodes: [...input.graphNodes],
      policiesApplied: [...input.policiesApplied],
      timelineEvents: [...input.timelineEvents],
      executivePlanId: input.executivePlanId,
      decisionHash: computeDecisionHash(input),
      timestamp: input.timestamp ?? new Date().toISOString(),
    };
  }

  verifyLineage(lineage: DecisionLineage): boolean {
    this.assertInput({
      decisionId: lineage.decisionId,
      memoryAtoms: lineage.memoryAtoms,
      graphNodes: lineage.graphNodes,
      policiesApplied: lineage.policiesApplied,
      timelineEvents: lineage.timelineEvents,
      executivePlanId: lineage.executivePlanId,
      timestamp: lineage.timestamp,
    });

    const recomputed = computeDecisionHash(lineage);
    return recomputed === lineage.decisionHash;
  }

  private assertInput(input: DecisionLineageInput): void {
    if (typeof input.decisionId !== "string" || input.decisionId.length === 0) {
      throw new Error("Decision lineage requires decisionId");
    }

    if (typeof input.executivePlanId !== "string" || input.executivePlanId.length === 0) {
      throw new Error("Decision lineage requires executivePlanId");
    }

    this.assertStringArray(input.memoryAtoms, "memoryAtoms");
    this.assertStringArray(input.graphNodes, "graphNodes");
    this.assertStringArray(input.policiesApplied, "policiesApplied");
    this.assertStringArray(input.timelineEvents, "timelineEvents");
  }

  private assertStringArray(value: unknown, field: string): void {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) {
      throw new Error(`Decision lineage requires ${field} to be a string array`);
    }
  }

  private assertReferences(input: DecisionLineageInput, refs: LineageValidationOptions): void {
    this.assertSetReferences("memoryAtoms", input.memoryAtoms, refs.existingMemoryAtoms);
    this.assertSetReferences("graphNodes", input.graphNodes, refs.existingGraphNodes);
    this.assertSetReferences("policiesApplied", input.policiesApplied, refs.existingPolicies);
    this.assertSetReferences("timelineEvents", input.timelineEvents, refs.existingTimelineEvents);
  }

  private assertSetReferences(field: string, ids: string[], existing?: Set<string>): void {
    if (!existing) {
      return;
    }

    for (const id of ids) {
      if (!existing.has(id)) {
        throw new Error(`Decision lineage ${field} reference does not exist: ${id}`);
      }
    }
  }
}
