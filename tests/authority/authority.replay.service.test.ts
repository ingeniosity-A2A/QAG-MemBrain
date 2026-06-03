import { describe, expect, it } from "vitest";
import { DecisionRecord } from "../../audit/decisions/decisionRecord.js";
import { AuthorityReplayEngine } from "../../authority/execution/authorityReplayEngine.js";
import { AuthorityReplayMetrics } from "../../authority/service/authorityReplayMetrics.js";
import { AuthorityReplayService } from "../../authority/service/authorityReplayService.js";
import { ReplayRepository } from "../../authority/persistence/replayRepository.js";
import { sealReplayRecord } from "../../authority/persistence/replayProof.js";
import { computeDecisionHash } from "../../lineage/hashing/decisionHash.js";
import { DecisionLineage, DecisionLineageInput } from "../../lineage/schemas/decisionLineage.js";
import { ReplayRecord, ReplayRecordInput } from "../../authority/service/replayRecord.js";
import { InMemoryCognitiveGraphRepository } from "../../graph/neo4j/repositories/cognitiveGraphRepository.js";

function buildLineage(decisionId = "decision-service-1"): DecisionLineage {
  const input: DecisionLineageInput = {
    decisionId,
    memoryAtoms: ["mem-1"],
    graphNodes: ["graph-1"],
    policiesApplied: ["policy-1"],
    policyEvaluations: [
      {
        policyId: "policy-1",
        result: "allow",
        reason: "allow",
        evidence: ["mem-1"],
        timestamp: "2026-06-03T09:00:00.000Z",
      },
    ],
    policyResults: ["allow"],
    policyEvidence: ["mem-1"],
    finalPolicyOutcome: "allow",
    timelineEvents: ["time-1"],
    executivePlanId: "plan-1",
    timestamp: "2026-06-03T09:00:00.000Z",
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
    timestamp: input.timestamp ?? "2026-06-03T09:00:00.000Z",
    decisionHash: computeDecisionHash(input),
  };
}

function buildFailureLineage(decisionId = "decision-service-failed-1"): DecisionLineage {
  const input: DecisionLineageInput = {
    decisionId,
    memoryAtoms: ["mem-1"],
    graphNodes: ["graph-1"],
    policiesApplied: ["policy-1"],
    policyEvaluations: [
      {
        policyId: "policy-1",
        result: "deny",
        reason: "policy denies",
        evidence: ["mem-1"],
        timestamp: "2026-06-03T09:01:00.000Z",
      },
    ],
    policyResults: ["deny"],
    policyEvidence: ["mem-1"],
    finalPolicyOutcome: "allow",
    timelineEvents: ["time-1"],
    executivePlanId: "plan-1",
    timestamp: "2026-06-03T09:01:00.000Z",
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
    timestamp: input.timestamp ?? "2026-06-03T09:01:00.000Z",
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

function buildService(
  decisions: Array<{ decision: DecisionRecord; lineage: DecisionLineage }>,
  graphRepository?: InMemoryCognitiveGraphRepository,
) {
  const inMemoryReplayRecords: ReplayRecord[] = [];

  const replayRepository: ReplayRepository = {
    append: async (record: ReplayRecordInput) => {
      inMemoryReplayRecords.push(sealReplayRecord(record));
    },
    list: async () => [...inMemoryReplayRecords],
  };

  return new AuthorityReplayService({
    loadDecision: async (decisionId) =>
      decisions.find((item) => item.decision.decisionId === decisionId)?.decision ?? null,
    loadLineage: async (lineageId) =>
      decisions.find((item) => item.lineage.decisionId === lineageId)?.lineage ?? null,
    loadMemoryReference: async (id) => ({ id }),
    loadGraphReference: async (id) => ({ id }),
    loadTimelineReference: async (id) => ({ id }),
    loadPolicyReference: async (id) => ({ id }),
    listDecisionIdsBySession: async (sessionId) =>
      sessionId === "session-1" ? decisions.map((item) => item.decision.decisionId) : [],
    listDecisionIdsByLineage: async (lineageId) =>
      decisions.filter((item) => item.lineage.decisionId === lineageId).map((item) => item.decision.decisionId),
    listDecisionIdsByRange: async () => decisions.map((item) => item.decision.decisionId),
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
    graphRepository,
  });
}

describe("Authority replay service", () => {
  it("replays a single decision and updates records", async () => {
    const lineage = buildLineage();
    const decision = buildDecision(lineage);
    const service = buildService([{ decision, lineage }]);
    const metrics = new AuthorityReplayMetrics();

    const response = await service.replay(decision.decisionId);
    metrics.recordReplay(5, response.status, response.failures);

    expect(response.status).toBe("VERIFIED");
    expect(response.failures).toEqual([]);
    const records = await service.listReplayRecords();
    expect(records).toHaveLength(1);
    expect(records[0].failureReasons).toEqual([]);
    expect(records[0].governanceVersion).toBe("1.4");
    expect(records[0].governanceHash).toBe("gov-hash-test");
    expect(records[0].manifestHash).toBe("manifest-hash-test");
    expect(records[0].attestationHash).toBe("attestation-hash-test");
    expect(records[0].runtimeVersion).toBe("0.1.0");
    expect(records[0].gitCommit).toBe("5e300b0d9aa609a973e25420a884e30af88b070a");
    expect(records[0].buildHash).toBe("build-hash-test");
    expect(records[0].buildTimestamp).toBe("2026-06-03T00:00:00.000Z");
    expect(records[0].worktreeDirty).toBe(true);
    expect(records[0].deploymentVersion).toBe("1.0.0");
    expect(records[0].deploymentHash).toBe("deployment-hash-test");
    expect(records[0].releaseId).toBe("release-test");
    expect(records[0].environment).toBe("development");
    expect(records[0].authorityOrder).toEqual(["JSONL", "Tashi", "Neo4j", "GSAP", "Runtime"]);
    expect(records[0].timestamp.length).toBeGreaterThan(0);
    expect(records[0].proof).toEqual({ algorithm: "sha256" });
    expect(records[0].signature.algorithm).toBe("ed25519");
    expect(records[0].signature.authorityId).toBe("ava007-authority-v1");
    expect(records[0].signature.signerId).toBe("ava007-authority-v1");
    expect(records[0].signature.signatureId.length).toBeGreaterThan(0);
    expect(metrics.snapshot().totalReplays).toBe(1);
    expect(metrics.snapshot().verifiedReplays).toBe(1);
  });

  it("materializes replay nodes and relationships when graph repository is configured", async () => {
    const lineage = buildLineage("decision-service-graph-1");
    const decision = buildDecision(lineage);
    const graphRepository = new InMemoryCognitiveGraphRepository();
    const service = buildService([{ decision, lineage }], graphRepository);

    const response = await service.replay(decision.decisionId);

    const replayNode = await graphRepository.getNode(response.reportId);
    const decisionContext = await graphRepository.getContext(decision.decisionId);
    const replayRelationshipTypes = decisionContext.outgoing
      .filter((relationship) => relationship.toId === response.reportId)
      .map((relationship) => relationship.type);

    expect(replayNode?.type).toBe("Replay");
    expect(replayNode?.properties.replayId).toBe(response.reportId);
    expect(replayNode?.properties.decisionId).toBe(decision.decisionId);
    expect(replayNode?.properties.lineageId).toBe(lineage.decisionId);
    expect(replayNode?.properties.governanceVersion).toBe("1.4");
    expect(replayNode?.properties.governanceHash).toBe("gov-hash-test");
    expect(replayNode?.properties.manifestHash).toBe("manifest-hash-test");
    expect(replayNode?.properties.attestationHash).toBe("attestation-hash-test");
    expect(replayNode?.properties.runtimeVersion).toBe("0.1.0");
    expect(replayNode?.properties.gitCommit).toBe("5e300b0d9aa609a973e25420a884e30af88b070a");
    expect(replayNode?.properties.buildHash).toBe("build-hash-test");
    expect(replayNode?.properties.buildTimestamp).toBe("2026-06-03T00:00:00.000Z");
    expect(replayNode?.properties.worktreeDirty).toBe(true);
    expect(replayNode?.properties.deploymentVersion).toBe("1.0.0");
    expect(replayNode?.properties.deploymentHash).toBe("deployment-hash-test");
    expect(replayNode?.properties.releaseId).toBe("release-test");
    expect(replayNode?.properties.environment).toBe("development");
    expect(replayNode?.properties.status).toBe("VERIFIED");
    expect(replayNode?.properties.authorityOrder).toEqual(["JSONL", "Tashi", "Neo4j", "GSAP", "Runtime"]);
    expect(typeof replayNode?.properties.timestamp).toBe("string");
    expect(typeof replayNode?.properties.replayHash).toBe("string");
    expect((replayNode?.properties.replayHash as string).length).toBeGreaterThan(0);
    expect(replayNode?.properties.signatureAlgorithm).toBe("ed25519");
    expect(replayNode?.properties.signatureAuthorityId).toBe("ava007-authority-v1");
    expect(replayNode?.properties.signatureSignerId).toBe("ava007-authority-v1");
    expect(typeof replayNode?.properties.signatureArtifactHash).toBe("string");
    expect(replayRelationshipTypes).toContain("REPLAYED");
    expect(replayRelationshipTypes).toContain("VERIFIED_BY");
    expect(replayRelationshipTypes).not.toContain("FAILED_BY");
  });

  it("creates separate replay graph events on repeated replay for the same decision", async () => {
    const lineage = buildLineage("decision-service-graph-repeat-1");
    const decision = buildDecision(lineage);
    const graphRepository = new InMemoryCognitiveGraphRepository();
    const service = buildService([{ decision, lineage }], graphRepository);

    const first = await service.replay(decision.decisionId);
    const second = await service.replay(decision.decisionId);

    const decisionContext = await graphRepository.getContext(decision.decisionId);
    const replayEdges = decisionContext.outgoing.filter((relationship) => relationship.type === "REPLAYED");
    const replayTargets = replayEdges.map((relationship) => relationship.toId);

    expect(first.reportId).not.toBe(second.reportId);
    expect(replayTargets).toContain(first.reportId);
    expect(replayTargets).toContain(second.reportId);
    expect(replayEdges).toHaveLength(2);
  });

  it("materializes failed replay using FAILED_BY and never VERIFIED_BY", async () => {
    const lineage = buildFailureLineage();
    const decision = buildDecision(lineage);
    const graphRepository = new InMemoryCognitiveGraphRepository();
    const service = buildService([{ decision, lineage }], graphRepository);

    const response = await service.replay(decision.decisionId);

    const replayNode = await graphRepository.getNode(response.reportId);
    const decisionContext = await graphRepository.getContext(decision.decisionId);
    const replayRelationshipTypes = decisionContext.outgoing
      .filter((relationship) => relationship.toId === response.reportId)
      .map((relationship) => relationship.type);

    expect(response.status).toBe("FAILED");
    expect(replayNode?.properties.status).toBe("FAILED");
    expect(replayRelationshipTypes).toContain("REPLAYED");
    expect(replayRelationshipTypes).toContain("FAILED_BY");
    expect(replayRelationshipTypes).not.toContain("VERIFIED_BY");
  });
});