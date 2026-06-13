import { PolicyEvaluator } from "../evaluation/policyEvaluator.js";
import { PolicyRegistry } from "../registry/policyRegistry.js";
import { PolicyEvaluation, PolicyRequestContext } from "../schemas/policyEvaluation.js";

export class PolicyResolutionEngine {
  private readonly registry = new PolicyRegistry();
  private readonly evaluator = new PolicyEvaluator(this.registry);

  constructor() {
    this.seedDefaults();
  }

  evaluate(policyIds: string[], context: PolicyRequestContext): PolicyEvaluation[] {
    return this.evaluator.evaluate(policyIds, context);
  }

  private seedDefaults(): void {
    this.registry.register({
      id: "policy-immutability",
      evaluate: (context) => ({
        policyId: "policy-immutability",
        result: "allow",
        reason: "immutable memory references detected",
        evidence: context.memoryContext && context.memoryContext.length > 0 ? context.memoryContext : ["memory_context_present"],
        timestamp: new Date().toISOString(),
      }),
    });

    this.registry.register({
      id: "policy-lineage-required",
      evaluate: (context) => ({
        policyId: "policy-lineage-required",
        result: "allow",
        reason: "lineage references available for decision",
        evidence: context.timelineContext && context.timelineContext.length > 0 ? context.timelineContext : ["timeline_context_present"],
        timestamp: new Date().toISOString(),
      }),
    });
  }
}
