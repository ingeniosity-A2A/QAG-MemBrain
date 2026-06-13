import { PolicyEvaluation } from "../schemas/policyEvaluation.js";

export type ResolutionOutcome = "allow" | "deny" | "advisory";

export interface PolicyPrecedence {
  deny: number;
  allow: number;
  advisory: number;
}

export const DEFAULT_POLICY_PRECEDENCE: PolicyPrecedence = {
  deny: 3,
  allow: 2,
  advisory: 1,
};

export function resolvePolicyOutcome(
  evaluations: PolicyEvaluation[],
  precedence: PolicyPrecedence = DEFAULT_POLICY_PRECEDENCE,
): ResolutionOutcome {
  if (evaluations.length === 0) {
    return "advisory";
  }

  const present = new Set(evaluations.map((evaluation) => evaluation.result));
  const ordered: ResolutionOutcome[] = ["deny", "allow", "advisory"];

  let winner: ResolutionOutcome = "advisory";
  let winnerScore = Number.NEGATIVE_INFINITY;

  for (const outcome of ordered) {
    if (!present.has(outcome)) {
      continue;
    }

    const score = precedence[outcome];
    if (score > winnerScore) {
      winner = outcome;
      winnerScore = score;
    }
  }

  return winner;
}