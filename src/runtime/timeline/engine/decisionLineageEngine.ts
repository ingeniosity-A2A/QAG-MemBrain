import {
  DecisionLineage,
  DecisionLineageInput,
  LineageValidationOptions,
} from "../schemas/decisionLineage.js";
import { PolicyEvaluation } from "../../policy/schemas/policyEvaluation.js";
import { resolvePolicyOutcome } from "../../policy/precedence/policyPrecedence.js";
import { computeDecisionHash } from "../hashing/decisionHash.js";

export class DecisionLineageEngine {
  createLineage(
    input: DecisionLineageInput,
    validationOptions: LineageValidationOptions = {},
  ): DecisionLineage {
    this.assertInput(input);
    this.assertReferences(input, validationOptions);

    const policyEvaluations = this.normalizePolicyEvaluations(input);
    const policyResults = input.policyResults ?? policyEvaluations.map((evaluation) => evaluation.result);
    const policyEvidence = input.policyEvidence ?? this.uniqueEvidence(policyEvaluations);
    const finalPolicyOutcome = input.finalPolicyOutcome ?? resolvePolicyOutcome(policyEvaluations);

    this.assertPolicyConsistency(policyEvaluations, policyResults, finalPolicyOutcome);

    return {
      decisionId: input.decisionId,
      memoryAtoms: [...input.memoryAtoms],
      graphNodes: [...input.graphNodes],
      policiesApplied: [...input.policiesApplied],
      policyEvaluations,
      policyResults,
      policyEvidence,
      finalPolicyOutcome,
      timelineEvents: [...input.timelineEvents],
      executivePlanId: input.executivePlanId,
      decisionHash: computeDecisionHash({
        ...input,
        policyEvaluations,
        policyResults,
        policyEvidence,
        finalPolicyOutcome,
      }),
      timestamp: input.timestamp ?? new Date().toISOString(),
    };
  }

  verifyLineage(lineage: DecisionLineage): boolean {
    this.assertInput({
      decisionId: lineage.decisionId,
      memoryAtoms: lineage.memoryAtoms,
      graphNodes: lineage.graphNodes,
      policiesApplied: lineage.policiesApplied,
      policyEvaluations: lineage.policyEvaluations,
      policyResults: lineage.policyResults,
      policyEvidence: lineage.policyEvidence,
      finalPolicyOutcome: lineage.finalPolicyOutcome,
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
    this.assertStringArray(input.policyResults ?? [], "policyResults");
    this.assertStringArray(input.policyEvidence ?? [], "policyEvidence");
    this.assertStringArray(input.timelineEvents, "timelineEvents");
    this.assertPolicyEvaluations(input.policyEvaluations ?? []);
    this.assertFinalPolicyOutcome(input.finalPolicyOutcome);
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

  private assertPolicyEvaluations(evaluations: PolicyEvaluation[]): void {
    for (const evaluation of evaluations) {
      if (typeof evaluation.policyId !== "string" || evaluation.policyId.length === 0) {
        throw new Error("Decision lineage requires policyEvaluations with policyId");
      }

      if (!["allow", "deny", "advisory"].includes(evaluation.result)) {
        throw new Error("Decision lineage requires policyEvaluations with valid result");
      }

      if (typeof evaluation.reason !== "string" || evaluation.reason.length === 0) {
        throw new Error("Decision lineage requires policyEvaluations with reason");
      }

      if (!Array.isArray(evaluation.evidence) || evaluation.evidence.some((item: any) => typeof item !== "string")) {
        throw new Error("Decision lineage requires policyEvaluations with evidence array");
      }
    }
  }

  private assertFinalPolicyOutcome(finalPolicyOutcome: unknown): void {
    if (typeof finalPolicyOutcome === "undefined") {
      return;
    }

    if (!["allow", "deny", "advisory"].includes(String(finalPolicyOutcome))) {
      throw new Error("Decision lineage requires finalPolicyOutcome with valid result");
    }
  }

  private assertPolicyConsistency(
    policyEvaluations: PolicyEvaluation[],
    policyResults: string[],
    finalPolicyOutcome: string,
  ): void {
    const resultsFromEvaluations = policyEvaluations.map((evaluation) => evaluation.result);
    if (resultsFromEvaluations.length !== policyResults.length) {
      throw new Error("Decision lineage policyResults must match policyEvaluations length");
    }

    for (let i = 0; i < resultsFromEvaluations.length; i += 1) {
      if (resultsFromEvaluations[i] !== policyResults[i]) {
        throw new Error("Decision lineage policyResults must match policyEvaluations ordering");
      }
    }

    const resolvedOutcome = resolvePolicyOutcome(policyEvaluations);
    if (resolvedOutcome !== finalPolicyOutcome) {
      throw new Error("Decision lineage finalPolicyOutcome must match resolved policy outcome");
    }
  }

  private normalizePolicyEvaluations(input: DecisionLineageInput): PolicyEvaluation[] {
    if (input.policyEvaluations && input.policyEvaluations.length > 0) {
      return input.policyEvaluations.map((evaluation) => ({
        ...evaluation,
        evidence: [...evaluation.evidence],
      }));
    }

    const timestamp = input.timestamp ?? new Date().toISOString();
    return input.policiesApplied.map((policyId) => ({
      policyId,
      result: "advisory",
      reason: "policy referenced without explicit evaluation",
      evidence: [],
      timestamp,
    }));
  }

  private uniqueEvidence(evaluations: PolicyEvaluation[]): string[] {
    return [...new Set(evaluations.flatMap((evaluation) => evaluation.evidence))];
  }
}
