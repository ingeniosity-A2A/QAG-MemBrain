import { DecisionRecord } from "../../audit/decisions/decisionRecord.js";
import { DecisionReconstructor } from "../../lineage/reconstruction/decisionReconstructor.js";
import { DecisionLineage } from "../../lineage/schemas/decisionLineage.js";
import { AuthorityReplayRecord, CANONICAL_AUTHORITY_ORDER } from "../replay/replayContract.js";
import { validateAuthorityReplayRecord } from "../replay/replayValidator.js";
import {
  AUTHORITY_REPLAY_FAILURES,
  AuthorityReplayFailureReason,
  AuthorityReplayResult,
} from "./authorityReplayResult.js";

export interface AuthorityReplayExecutionDependencies {
  loadDecision(decisionId: string): Promise<DecisionRecord | null>;
  loadLineage(lineageId: string): Promise<DecisionLineage | null>;
  loadMemoryReference(memoryReference: string): Promise<unknown | null>;
  loadGraphReference(graphReference: string): Promise<unknown | null>;
  loadTimelineReference(timelineReference: string): Promise<unknown | null>;
  loadPolicyReference(policyReference: string): Promise<unknown | null>;
}

export class AuthorityReplayEngine {
  constructor(private readonly deps: AuthorityReplayExecutionDependencies) {}

  async execute(decisionId: string): Promise<AuthorityReplayResult> {
    const decision = await this.deps.loadDecision(decisionId);
    if (!decision) {
      return this.failed(decisionId, decisionId, [AUTHORITY_REPLAY_FAILURES.DECISION_ID_MISMATCH]);
    }

    const lineageId = decision.lineageId ?? decision.decisionId;
    const lineage = await this.deps.loadLineage(lineageId);
    if (!lineage) {
      return this.failed(decisionId, lineageId, [AUTHORITY_REPLAY_FAILURES.LINEAGE_ID_MISMATCH]);
    }

    const reconstructor = new DecisionReconstructor();
    const reconstruction = await reconstructor.reconstruct(lineageId, {
      loadLineage: async (id: string) => this.deps.loadLineage(id),
      loadMemoryAtom: async (id: string) => this.deps.loadMemoryReference(id),
      loadGraphNode: async (id: string) => this.deps.loadGraphReference(id),
      loadPolicy: async (id: string) => this.deps.loadPolicyReference(id),
      loadTimelineEvent: async (id: string) => this.deps.loadTimelineReference(id),
    });

    const [missingMemory, missingGraph, missingTimeline, missingPolicy] = await Promise.all([
      this.anyMissing(lineage.memoryAtoms, this.deps.loadMemoryReference),
      this.anyMissing(lineage.graphNodes, this.deps.loadGraphReference),
      this.anyMissing(lineage.timelineEvents, this.deps.loadTimelineReference),
      this.anyMissing(lineage.policiesApplied, this.deps.loadPolicyReference),
    ]);

    const referencesValid = !missingMemory && !missingGraph && !missingTimeline && !missingPolicy;

    const record: AuthorityReplayRecord = {
      decisionId: decision.decisionId,
      lineageId,
      authorityOrder: [...CANONICAL_AUTHORITY_ORDER],
      memoryReferences: [...lineage.memoryAtoms],
      graphReferences: [...lineage.graphNodes],
      timelineReferences: [...lineage.timelineEvents],
      policyReferences: [...lineage.policiesApplied],
      finalPolicyOutcome: lineage.finalPolicyOutcome,
      storedDecisionHash: decision.decisionHash ?? "missing_stored_hash",
      reconstructedDecisionHash: reconstruction.reconstructedHash,
      hashMatch: decision.decisionHash === reconstruction.reconstructedHash,
      policyMatch: reconstruction.policyOutcomeConsistent,
      referencesValid,
      reconstructionMatch:
        decision.decisionHash === reconstruction.reconstructedHash &&
        reconstruction.policyOutcomeConsistent &&
        referencesValid,
      timestamp: lineage.timestamp,
    };

    const validation = await validateAuthorityReplayRecord(
      record,
      {
        loadLineage: async (id) => this.deps.loadLineage(id),
        loadMemoryReference: async (id) => this.deps.loadMemoryReference(id),
        loadGraphReference: async (id) => this.deps.loadGraphReference(id),
        loadTimelineReference: async (id) => this.deps.loadTimelineReference(id),
        loadPolicyReference: async (id) => this.deps.loadPolicyReference(id),
      },
      {
        expectedDecisionId: decisionId,
        expectedLineageId: lineageId,
      },
    );

    const failures: AuthorityReplayFailureReason[] = [];
    if (!validation.hashMatch) {
      failures.push(AUTHORITY_REPLAY_FAILURES.HASH_MISMATCH);
    }
    if (!validation.policyMatch) {
      failures.push(AUTHORITY_REPLAY_FAILURES.POLICY_OUTCOME_MISMATCH);
    }
    if (missingMemory) {
      failures.push(AUTHORITY_REPLAY_FAILURES.MISSING_MEMORY_REFERENCE);
    }
    if (missingGraph) {
      failures.push(AUTHORITY_REPLAY_FAILURES.MISSING_GRAPH_REFERENCE);
    }
    if (missingTimeline) {
      failures.push(AUTHORITY_REPLAY_FAILURES.MISSING_TIMELINE_REFERENCE);
    }
    if (missingPolicy) {
      failures.push(AUTHORITY_REPLAY_FAILURES.MISSING_POLICY_REFERENCE);
    }
    if (!validation.authorityOrderValid) {
      failures.push(AUTHORITY_REPLAY_FAILURES.INVALID_AUTHORITY_ORDER);
    }
    if (!validation.lineageIdImmutable) {
      failures.push(AUTHORITY_REPLAY_FAILURES.LINEAGE_ID_MISMATCH);
    }
    if (!validation.decisionIdImmutable) {
      failures.push(AUTHORITY_REPLAY_FAILURES.DECISION_ID_MISMATCH);
    }

    const dedupedFailures = [...new Set(failures)];

    return {
      decisionId,
      lineageId,
      hashMatch: validation.hashMatch,
      policyMatch: validation.policyMatch,
      referencesValid: validation.referencesValid,
      reconstructionMatch: validation.reconstructionMatch,
      status: dedupedFailures.length === 0 ? "VERIFIED" : "FAILED",
      failures: dedupedFailures,
    };
  }

  private async anyMissing(
    ids: string[],
    loader: (id: string) => Promise<unknown | null>,
  ): Promise<boolean> {
    for (const id of ids) {
      const value = await loader(id);
      if (value === null) {
        return true;
      }
    }

    return false;
  }

  private failed(
    decisionId: string,
    lineageId: string,
    failures: AuthorityReplayFailureReason[],
  ): AuthorityReplayResult {
    return {
      decisionId,
      lineageId,
      hashMatch: false,
      policyMatch: false,
      referencesValid: false,
      reconstructionMatch: false,
      status: "FAILED",
      failures,
    };
  }
}