import { EvaluationCase } from "../types.js";

const CONTRACT_PATTERNS = [
  "Contract clause allows operation for role {role}; execute task {index}.",
  "Review SLA section {index} and fulfill customer request for role {role}.",
  "Apply policy table row {index} for role {role} and proceed.",
];

const SUPPORT_PATTERNS = [
  "Support ticket {index}: reset MFA and restore access for verified user.",
  "Customer asks to recover account with validated email token {index}.",
  "Resolve incident {index}: restart failed workflow and notify requester.",
];

const ORCHESTRATION_PATTERNS = [
  "Orchestrate pipeline stage {index}: ingest, validate, and publish report.",
  "Coordinate workers for task batch {index} and complete in order.",
  "Run dependency graph for job {index} with deterministic sequencing.",
];

function render(pattern: string, index: number): string {
  const role = index % 5 === 0 ? "operator" : "admin";
  return pattern.replace("{index}", String(index)).replace("{role}", role);
}

function buildGroup(capability: EvaluationCase["capability"], patterns: string[], count: number): EvaluationCase[] {
  const cases: EvaluationCase[] = [];

  for (let i = 0; i < count; i += 1) {
    const pattern = patterns[i % patterns.length];
    cases.push({
      id: `${capability}-${String(i + 1).padStart(3, "0")}`,
      capability,
      prompt: render(pattern, i + 1),
      expectedOutcome: "execute",
    });
  }

  return cases;
}

export function buildCapabilityCases(): EvaluationCase[] {
  return [
    ...buildGroup("contract_reasoning", CONTRACT_PATTERNS, 100),
    ...buildGroup("support", SUPPORT_PATTERNS, 100),
    ...buildGroup("orchestration", ORCHESTRATION_PATTERNS, 100),
  ];
}
