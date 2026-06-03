import { PolicyEvaluation, PolicyRequestContext } from "../schemas/policyEvaluation.js";

export type PolicyRule = {
  id: string;
  evaluate(context: PolicyRequestContext): PolicyEvaluation;
};

export class PolicyRegistry {
  private readonly rules = new Map<string, PolicyRule>();

  register(rule: PolicyRule): void {
    this.rules.set(rule.id, rule);
  }

  get(policyId: string): PolicyRule | null {
    return this.rules.get(policyId) ?? null;
  }

  list(): string[] {
    return [...this.rules.keys()];
  }
}
