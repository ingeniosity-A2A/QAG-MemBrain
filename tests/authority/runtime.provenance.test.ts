import { describe, expect, it } from "vitest";
import { AuditEngine, DecisionRecord } from "../../audit/decisions/decisionRecord.js";
import { BasicExecutiveRuntime } from "../../brain/executive/runtime.js";
import { AuthorityReplayService } from "../../authority/service/authorityReplayService.js";
import { ReplayRecord, ReplayRecordInput } from "../../authority/service/replayRecord.js";
import { ReplayRepository } from "../../authority/persistence/replayRepository.js";
import { sealReplayRecord } from "../../authority/persistence/replayProof.js";
import { DecisionLineage } from "../../lineage/schemas/decisionLineage.js";

const runtimeSnapshot = {
  runtimeVersion: "0.1.0",
  runtimeHash: "runtime-hash-chain",
  deploymentHash: "deployment-hash-chain",
  buildHash: "build-hash-chain",
  processId: 9191,
  hostname: "chain-host",
  nodeVersion: "v22.0.0",
  platform: "linux",
  startedAt: "2026-06-03T00:00:00.000Z",
};

describe("Runtime provenance chain", () => {
  it("keeps runtimeHash consistent across decision and replay records", async () => {
    const audit = new AuditEngine();
    const executive = new BasicExecutiveRuntime(
      audit,
      undefined,
      undefined,
      () => ({
        runtimeVersion: "0.1.0",
        gitCommit: "5e300b0d9aa609a973e25420a884e30af88b070a",
        buildHash: "build-hash-chain",
        buildTimestamp: "2026-06-03T00:00:00.000Z",
        worktreeDirty: true,
        manifestPath: "authority/build/buildManifest.json",
        loadedAt: "2026-06-03T00:00:00.000Z",
      }),
      () => ({
        deploymentVersion: "1.0.0",
        deploymentHash: "deployment-hash-chain",
        releaseId: "release-chain",
        environment: "development",
        buildHash: "build-hash-chain",
        containerHash: "container-hash-chain",
        deployedAt: "2026-06-03T00:00:00.000Z",
        manifestPath: "authority/deployment/deploymentManifest.json",
        loadedAt: "2026-06-03T00:00:00.000Z",
      }),
      () => runtimeSnapshot,
    );

    const lineage = executive.recordDecisionWithLineage({
      decisionId: "decision-runtime-chain-1",
      memoryAtoms: ["m1"],
      graphNodes: ["g1"],
      policiesApplied: ["p1"],
      timelineEvents: ["t1"],
      executivePlanId: "plan-1",
    });

    const decision = audit.list()[0] as DecisionRecord;
    const records: ReplayRecord[] = [];
    const replayRepository: ReplayRepository = {
      append: async (record: ReplayRecordInput) => {
        records.push(sealReplayRecord(record));
      },
      list: async () => [...records],
    };

    const service = new AuthorityReplayService({
      loadDecision: async () => decision,
      loadLineage: async () => lineage as DecisionLineage,
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
        buildHash: "build-hash-chain",
        buildTimestamp: "2026-06-03T00:00:00.000Z",
        worktreeDirty: true,
        manifestPath: "authority/build/buildManifest.json",
        loadedAt: "2026-06-03T00:00:00.000Z",
      }),
      loadDeploymentSnapshot: () => ({
        deploymentVersion: "1.0.0",
        deploymentHash: "deployment-hash-chain",
        releaseId: "release-chain",
        environment: "development",
        buildHash: "build-hash-chain",
        containerHash: "container-hash-chain",
        deployedAt: "2026-06-03T00:00:00.000Z",
        manifestPath: "authority/deployment/deploymentManifest.json",
        loadedAt: "2026-06-03T00:00:00.000Z",
      }),
      loadRuntimeSnapshot: () => runtimeSnapshot,
      replayRepository,
    });

    await service.replay(decision.decisionId);

    expect(decision.runtimeHash).toBe("runtime-hash-chain");
    expect(records[0].runtimeHash).toBe("runtime-hash-chain");
    expect(decision.runtimeHash).toBe(records[0].runtimeHash);
  });
});
