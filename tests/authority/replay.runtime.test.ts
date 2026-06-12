import { describe, expect, it } from "vitest";
import { DecisionRecord } from "../../audit/decisions/decisionRecord.js";
import { AuthorityReplayService } from "../../authority/service/authorityReplayService.js";
import { ReplayRecord, ReplayRecordInput } from "../../authority/service/replayRecord.js";
import { ReplayRepository } from "../../authority/persistence/replayRepository.js";
import { sealReplayRecord } from "../../authority/persistence/replayProof.js";
import { computeDecisionHash } from "../../lineage/hashing/decisionHash.js";
import { DecisionLineage, DecisionLineageInput } from "../../lineage/schemas/decisionLineage.js";
import { InMemoryCognitiveGraphRepository } from "../../graph/neo4j/repositories/cognitiveGraphRepository.js";

function buildLineage(): DecisionLineage {
  const input: DecisionLineageInput = {
    decisionId: "decision-runtime-replay-1",
    memoryAtoms: ["m1"],
    graphNodes: ["g1"],
    policiesApplied: ["p1"],
    policyEvaluations: [],
    policyResults: ["allow"],
    policyEvidence: [],
    finalPolicyOutcome: "allow",
    timelineEvents: ["t1"],
    executivePlanId: "plan-1",
    timestamp: "2026-06-03T00:00:00.000Z",
  };

  return {
    ...input,
    policyEvaluations: input.policyEvaluations ?? [],
    policyResults: input.policyResults ?? [],
    policyEvidence: input.policyEvidence ?? [],
    finalPolicyOutcome: input.finalPolicyOutcome ?? "advisory",
    timestamp: input.timestamp ?? "2026-06-03T00:00:00.000Z",
    decisionHash: computeDecisionHash(input),
  };
}

function buildDecision(lineage: DecisionLineage): DecisionRecord {
  return {
    decisionId: lineage.decisionId,
    memories: [...lineage.memoryAtoms],
    policies: [...lineage.policiesApplied],
    relationships: [...lineage.graphNodes],
    timestamp: lineage.timestamp,
    executionPath: ["reflex", "executive"],
    lineageId: lineage.decisionId,
    decisionHash: lineage.decisionHash,
    runtimeHash: "runtime-hash-replay",
  };
}

describe("Replay runtime provenance", () => {
  it("persists and materializes runtime hash on replay artifacts", async () => {
    const lineage = buildLineage();
    const decision = buildDecision(lineage);
    const graphRepository = new InMemoryCognitiveGraphRepository();
    const records: ReplayRecord[] = [];

    const replayRepository: ReplayRepository = {
      append: async (record: ReplayRecordInput) => {
        records.push(sealReplayRecord(record));
      },
      list: async () => [...records],
    };

    const runtimeSnapshot = {
      runtimeVersion: "0.1.0",
      runtimeHash: "runtime-hash-replay",
      deploymentHash: "deployment-hash-replay",
      buildHash: "build-hash-replay",
      processId: 9001,
      hostname: "replay-host",
      nodeVersion: "v22.0.0",
      platform: "linux",
      startedAt: "2026-06-03T00:00:00.000Z",
    };

    const service = new AuthorityReplayService({
      loadDecision: async () => decision,
      loadLineage: async () => lineage,
      loadMemoryReference: async (id) => ({ id }),
      loadGraphReference: async (id) => ({ id }),
      loadTimelineReference: async (id) => ({ id }),
      loadPolicyReference: async (id) => ({ id }),
      listDecisionIdsBySession: async () => [decision.decisionId],
      listDecisionIdsByLineage: async () => [decision.decisionId],
      listDecisionIdsByRange: async () => [decision.decisionId],
      loadGovernanceSnapshot: async () => ({
        governanceVersion: "1.5",
        governanceHash: "gov-hash",
        manifestHash: "manifest-hash",
        attestationHash: "attestation-hash",
        authorityOrder: ["JSONL", "Tashi", "Neo4j", "GSAP", "Runtime"],
        sourcePath: "governance/ava007/AVA007_RUNTIME_GOVERNANCE.md",
        manifestPath: "governance/manifest.json",
        attestationPath: "governance/attestation.json",
        loadedAt: "2026-06-03T00:00:00.000Z",
      }),
      loadBuildSnapshot: () => ({
        runtimeVersion: "0.1.0",
        gitCommit: "5e300b0d9aa609a973e25420a884e30af88b070a",
        buildHash: "build-hash-replay",
        buildTimestamp: "2026-06-03T00:00:00.000Z",
        worktreeDirty: true,
        manifestPath: "authority/build/buildManifest.json",
        loadedAt: "2026-06-03T00:00:00.000Z",
      }),
      loadDeploymentSnapshot: () => ({
        deploymentVersion: "1.0.0",
        deploymentHash: "deployment-hash-replay",
        releaseId: "release-replay",
        environment: "development",
        buildHash: "build-hash-replay",
        containerHash: "container-hash-replay",
        deployedAt: "2026-06-03T00:00:00.000Z",
        manifestPath: "authority/deployment/deploymentManifest.json",
        loadedAt: "2026-06-03T00:00:00.000Z",
      }),
      loadRuntimeSnapshot: () => runtimeSnapshot,
      replayRepository,
      graphRepository,
    });

    const response = await service.replay(decision.decisionId);
    const replayNode = await graphRepository.getNode(response.reportId);

    expect(records).toHaveLength(1);
    expect(records[0].runtimeHash).toBe("runtime-hash-replay");
    expect(replayNode?.properties.runtimeHash).toBe("runtime-hash-replay");
  });
});
