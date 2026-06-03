import { describe, expect, it } from "vitest";
import { DecisionRecord } from "../../audit/decisions/decisionRecord.js";
import { AuthorityReplayEngine } from "../../authority/execution/authorityReplayEngine.js";
import { ReplayRepository } from "../../authority/persistence/replayRepository.js";
import { sealReplayRecord } from "../../authority/persistence/replayProof.js";
import { AuthorityReplayService } from "../../authority/service/authorityReplayService.js";
import { ReplayRecord, ReplayRecordInput } from "../../authority/service/replayRecord.js";
import { computeDecisionHash } from "../../lineage/hashing/decisionHash.js";
import { DecisionLineage, DecisionLineageInput } from "../../lineage/schemas/decisionLineage.js";

function buildLineage(): DecisionLineage {
  const input: DecisionLineageInput = {
    decisionId: "decision-idempotent-1",
    memoryAtoms: ["mem-1"],
    graphNodes: ["graph-1"],
    policiesApplied: ["policy-1"],
    policyEvaluations: [
      {
        policyId: "policy-1",
        result: "allow",
        reason: "allow",
        evidence: ["mem-1"],
        timestamp: "2026-06-03T09:03:00.000Z",
      },
    ],
    policyResults: ["allow"],
    policyEvidence: ["mem-1"],
    finalPolicyOutcome: "allow",
    timelineEvents: ["time-1"],
    executivePlanId: "plan-1",
    timestamp: "2026-06-03T09:03:00.000Z",
  };

  return {
    decisionId: input.decisionId,
    memoryAtoms: input.memoryAtoms,
    graphNodes: input.graphNodes,
    policiesApplied: input.policiesApplied,
    policyEvaluations: input.policyEvaluations ?? [],
    policyResults: input.policyResults ?? [],
    policyEvidence: input.policyEvidence ?? [],
    finalPolicyOutcome: input.finalPolicyOutcome ?? "advisory",
    timelineEvents: input.timelineEvents,
    executivePlanId: input.executivePlanId,
    timestamp: input.timestamp ?? "2026-06-03T09:03:00.000Z",
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
  };
}

describe("Authority replay idempotency", () => {
  it("returns identical outcomes on repeated replay and does not mutate lineage", async () => {
    const lineage = buildLineage();
    const decision = buildDecision(lineage);
    const replayRecords: ReplayRecord[] = [];

    const replayRepository: ReplayRepository = {
      append: async (record: ReplayRecordInput) => {
        replayRecords.push(sealReplayRecord(record));
      },
      list: async () => [...replayRecords],
    };

    const service = new AuthorityReplayService({
      loadDecision: async () => decision,
      loadLineage: async () => lineage,
      loadMemoryReference: async (id) => ({ id }),
      loadGraphReference: async (id) => ({ id }),
      loadTimelineReference: async (id) => ({ id }),
      loadPolicyReference: async (id) => ({ id }),
      listDecisionIdsBySession: async () => [],
      listDecisionIdsByLineage: async () => [decision.decisionId],
      listDecisionIdsByRange: async () => [decision.decisionId],
      loadGovernanceSnapshot: async () => ({
        governanceVersion: "1.4",
        governanceHash: "gov-hash-test",
        manifestHash: "manifest-hash-test",
        attestationHash: "attestation-hash-test",
        authorityOrder: ["JSONL", "Tashi", "Neo4j", "GSAP", "Runtime"],
        sourcePath: "governance/ava007/AVA007_RUNTIME_GOVERNANCE.md",
        manifestPath: "governance/manifest.json",
        attestationPath: "governance/attestation.json",
        loadedAt: "2026-06-03T00:00:00.000Z",
      }),
      loadBuildSnapshot: () => ({
        runtimeVersion: "0.1.0",
        gitCommit: "5e300b0d9aa609a973e25420a884e30af88b070a",
        buildHash: "build-hash-test",
        buildTimestamp: "2026-06-03T00:00:00.000Z",
        worktreeDirty: true,
        manifestPath: "authority/build/buildManifest.json",
        loadedAt: "2026-06-03T00:00:00.000Z",
      }),
      loadDeploymentSnapshot: () => ({
        deploymentVersion: "1.0.0",
        deploymentHash: "deployment-hash-test",
        releaseId: "release-test",
        environment: "development",
        buildHash: "build-hash-test",
        containerHash: "container-hash-test",
        deployedAt: "2026-06-03T00:00:00.000Z",
        manifestPath: "authority/deployment/deploymentManifest.json",
        loadedAt: "2026-06-03T00:00:00.000Z",
      }),
      replayRepository,
    });

    const first = await service.replay(decision.decisionId);
    const second = await service.replay(decision.decisionId);

    expect(first.status).toBe(second.status);
    expect(first.failures).toEqual(second.failures);
    const records = await service.listReplayRecords();
    expect(records).toHaveLength(2);
    expect(records[0].failureReasons).toEqual(records[1].failureReasons);
    expect(records[0].governanceVersion).toBe("1.4");
    expect(records[1].governanceVersion).toBe("1.4");
    expect(records[0].governanceHash).toBe("gov-hash-test");
    expect(records[1].governanceHash).toBe("gov-hash-test");
    expect(records[0].manifestHash).toBe("manifest-hash-test");
    expect(records[1].manifestHash).toBe("manifest-hash-test");
    expect(records[0].attestationHash).toBe("attestation-hash-test");
    expect(records[1].attestationHash).toBe("attestation-hash-test");
    expect(records[0].runtimeVersion).toBe("0.1.0");
    expect(records[1].runtimeVersion).toBe("0.1.0");
    expect(records[0].gitCommit).toBe("5e300b0d9aa609a973e25420a884e30af88b070a");
    expect(records[1].gitCommit).toBe("5e300b0d9aa609a973e25420a884e30af88b070a");
    expect(records[0].buildHash).toBe("build-hash-test");
    expect(records[1].buildHash).toBe("build-hash-test");
    expect(records[0].buildTimestamp).toBe("2026-06-03T00:00:00.000Z");
    expect(records[1].buildTimestamp).toBe("2026-06-03T00:00:00.000Z");
    expect(records[0].worktreeDirty).toBe(true);
    expect(records[1].worktreeDirty).toBe(true);
    expect(records[0].deploymentVersion).toBe("1.0.0");
    expect(records[1].deploymentVersion).toBe("1.0.0");
    expect(records[0].deploymentHash).toBe("deployment-hash-test");
    expect(records[1].deploymentHash).toBe("deployment-hash-test");
    expect(records[0].releaseId).toBe("release-test");
    expect(records[1].releaseId).toBe("release-test");
    expect(records[0].environment).toBe("development");
    expect(records[1].environment).toBe("development");
    expect(records[0].proof).toEqual({ algorithm: "sha256" });
    expect(records[1].proof).toEqual({ algorithm: "sha256" });
    expect(lineage.decisionHash).toBe(decision.decisionHash);
    expect(lineage.finalPolicyOutcome).toBe("allow");
  });
});