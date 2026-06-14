import { computeDecisionHash } from "../../lineage/hashing/decisionHash.js";
import { DecisionLineage } from "../../lineage/schemas/decisionLineage.js";
import { resolvePolicyOutcome } from "../../policy/precedence/policyPrecedence.js";
import { AuthorityReplayRecord, CANONICAL_AUTHORITY_ORDER } from "./replayContract.js";
import { assertAuthorityReplayRecordShape } from "./replaySchema.js";

export interface ReplayValidationDependencies {
  loadLineage(lineageId: string): Promise<DecisionLineage | null>;
  loadMemoryReference(memoryReference: string): Promise<unknown | null>;
  loadGraphReference(graphReference: string): Promise<unknown | null>;
  loadTimelineReference(timelineReference: string): Promise<unknown | null>;
  loadPolicyReference(policyReference: string): Promise<unknown | null>;
}

export interface ReplayValidationOptions {
  expectedDecisionId?: string;
  expectedLineageId?: string;
}

export interface ReplayValidationResult {
  hashMatch: boolean;
  policyMatch: boolean;
  referencesValid: boolean;
  lineageIdImmutable: boolean;
  decisionIdImmutable: boolean;
  authorityOrderValid: boolean;
  reconstructionMatch: boolean;
  status: "VERIFIED" | "FAILED";
  issues: string[];
}

export async function validateAuthorityReplayRecord(
  record: AuthorityReplayRecord,
  deps: ReplayValidationDependencies,
  options: ReplayValidationOptions = {},
): Promise<ReplayValidationResult> {
  assertAuthorityReplayRecordShape(record);

  const issues: string[] = [];
  const authorityOrderValid = hasCanonicalAuthorityOrder(record);
  if (!authorityOrderValid) {
    issues.push("authority order invariant failed");
  }

  const lineage = await deps.loadLineage(record.lineageId);

  if (!lineage) {
    issues.push(`lineage not found: ${record.lineageId}`);

    return {
      hashMatch: false,
      policyMatch: false,
      referencesValid: false,
      lineageIdImmutable: false,
      decisionIdImmutable: false,
      authorityOrderValid,
      reconstructionMatch: false,
      status: "FAILED",
      issues,
    };
  }

  const lineageIdImmutable =
    (options.expectedLineageId ? record.lineageId === options.expectedLineageId : true) &&
    record.lineageId === lineage.decisionId;
  if (!lineageIdImmutable) {
    issues.push("lineageId immutable invariant failed");
  }

  const decisionIdImmutable =
    (options.expectedDecisionId ? record.decisionId === options.expectedDecisionId : true) &&
    record.decisionId === lineage.decisionId;
  if (!decisionIdImmutable) {
    issues.push("decisionId immutable invariant failed");
  }

  const reconstructedHash = computeDecisionHash({
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

  const hashMatch =
    record.storedDecisionHash === reconstructedHash &&
    record.reconstructedDecisionHash === reconstructedHash;
  if (!hashMatch) {
    issues.push("stored hash and reconstructed hash mismatch");
  }
  if (record.hashMatch !== hashMatch) {
    issues.push("stored hashMatch flag mismatch");
  }

  const reconstructedPolicyOutcome = resolvePolicyOutcome(lineage.policyEvaluations);
  const policyMatch = record.finalPolicyOutcome === reconstructedPolicyOutcome;
  if (!policyMatch) {
    issues.push("stored policy outcome and reconstructed policy outcome mismatch");
  }
  if (record.policyMatch !== policyMatch) {
    issues.push("stored policyMatch flag mismatch");
  }

  const referencesValid = await allReferencesExist(record, deps);
  if (!referencesValid) {
    issues.push("one or more references are missing");
  }
  if (record.referencesValid !== referencesValid) {
    issues.push("stored referencesValid flag mismatch");
  }

  const reconstructionMatch =
    hashMatch && policyMatch && referencesValid && lineageIdImmutable && decisionIdImmutable && authorityOrderValid;
  if (record.reconstructionMatch !== reconstructionMatch) {
    issues.push("stored reconstructionMatch flag mismatch");
  }

  return {
    hashMatch,
    policyMatch,
    referencesValid,
    lineageIdImmutable,
    decisionIdImmutable,
    authorityOrderValid,
    reconstructionMatch,
    status: reconstructionMatch ? "VERIFIED" : "FAILED",
    issues,
  };
}

function hasCanonicalAuthorityOrder(record: AuthorityReplayRecord): boolean {
  if (record.authorityOrder.length !== CANONICAL_AUTHORITY_ORDER.length) {
    return false;
  }

  return record.authorityOrder.every((layer, index) => layer === CANONICAL_AUTHORITY_ORDER[index]);
}

async function allReferencesExist(
  record: AuthorityReplayRecord,
  deps: ReplayValidationDependencies,
): Promise<boolean> {
  const [memoryValid, graphValid, timelineValid, policyValid] = await Promise.all([
    allLoaded(record.memoryReferences, deps.loadMemoryReference),
    allLoaded(record.graphReferences, deps.loadGraphReference),
    allLoaded(record.timelineReferences, deps.loadTimelineReference),
    allLoaded(record.policyReferences, deps.loadPolicyReference),
  ]);

  return memoryValid && graphValid && timelineValid && policyValid;
}

async function allLoaded(
  ids: string[],
  loader: (id: string) => Promise<unknown | null>,
): Promise<boolean> {
  for (const id of ids) {
    const loaded = await loader(id);
    if (loaded === null) {
      return false;
    }
  }

  return true;
}
