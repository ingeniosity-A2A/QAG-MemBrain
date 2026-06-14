import { AuthorityReplayRecord } from "./replayContract.js";

export function assertAuthorityReplayRecordShape(record: AuthorityReplayRecord): void {
  assertNonEmptyString(record.decisionId, "decisionId");
  assertNonEmptyString(record.lineageId, "lineageId");
  assertNonEmptyString(record.storedDecisionHash, "storedDecisionHash");
  assertNonEmptyString(record.reconstructedDecisionHash, "reconstructedDecisionHash");
  assertNonEmptyString(record.timestamp, "timestamp");

  assertStringArray(record.authorityOrder, "authorityOrder");
  assertStringArray(record.memoryReferences, "memoryReferences");
  assertStringArray(record.graphReferences, "graphReferences");
  assertStringArray(record.timelineReferences, "timelineReferences");
  assertStringArray(record.policyReferences, "policyReferences");
  assertBoolean(record.hashMatch, "hashMatch");
  assertBoolean(record.policyMatch, "policyMatch");
  assertBoolean(record.referencesValid, "referencesValid");
  assertBoolean(record.reconstructionMatch, "reconstructionMatch");

  if (!["allow", "deny", "advisory"].includes(record.finalPolicyOutcome)) {
    throw new Error("Authority replay record requires finalPolicyOutcome to be allow, deny, or advisory");
  }
}

function assertNonEmptyString(value: string, field: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Authority replay record requires ${field}`);
  }
}

function assertStringArray(value: string[], field: string): void {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new Error(`Authority replay record requires ${field} to be a string array`);
  }
}

function assertBoolean(value: boolean, field: string): void {
  if (typeof value !== "boolean") {
    throw new Error(`Authority replay record requires ${field} to be a boolean`);
  }
}
