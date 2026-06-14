import { PolicyRegistry } from "../registry/policyRegistry.js";
import { PolicyEvaluation, PolicyRequestContext } from "../schemas/policyEvaluation.js";

export class PolicyEvaluator {
  constructor(private readonly registry: PolicyRegistry) {}

  evaluate(policyIds: string[], context: PolicyRequestContext): PolicyEvaluation[] {
    const now = new Date().toISOString();

    return policyIds.map((policyId) => {
      const rule = this.registry.get(policyId);
      if (!rule) {
        return {
          policyId,
          result: "advisory",
          reason: "policy not found in registry",
          evidence: ["policy_registry_miss"],
          timestamp: now,
        } satisfies PolicyEvaluation;
      }

      return rule.evaluate(context);
    });
  }
}
