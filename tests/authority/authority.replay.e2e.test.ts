import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AuditEngine, DecisionRecord } from "../../audit/decisions/decisionRecord.js";
import { JsonlReplayRepository } from "../../authority/persistence/replayRepository.js";
import { AuthorityReplayService } from "../../authority/service/authorityReplayService.js";
import { AuthorityReplayRecord, CANONICAL_AUTHORITY_ORDER } from "../../authority/replay/replayContract.js";
import { buildReplayReport } from "../../authority/replay/replayReport.js";
import { validateAuthorityReplayRecord } from "../../authority/replay/replayValidator.js";
import { InMemoryCognitiveGraphRepository } from "../../graph/neo4j/repositories/cognitiveGraphRepository.js";
import { DecisionReconstructor } from "../../lineage/reconstruction/decisionReconstructor.js";
import { DecisionLineage } from "../../lineage/schemas/decisionLineage.js";
import { BasicExecutiveRuntime } from "../../brain/executive/runtime.js";

const cleanupTargets: string[] = [];

afterEach(async () => {
  while (cleanupTargets.length > 0) {
    const path = cleanupTargets.pop();
    if (path) {
      await rm(path, { recursive: true, force: true });
    }
  }
});

describe("Authority replay full-chain e2e", () => {
  it("proves authority chain across governance, replay, persistence, graph, restart, reconstruction, and reporting", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "qag-authority-e2e-"));
    cleanupTargets.push(tempDir);

    const replayLedgerPath = join(tempDir, "replay.jsonl");
    const replayRepository = new JsonlReplayRepository(replayLedgerPath);
    const graphRepository = new InMemoryCognitiveGraphRepository();

    const governanceSnapshot = {
      governanceVersion: "1.4",
      governanceHash: "gov-hash-e2e",
      manifestHash: "manifest-hash-e2e",
      attestationHash: "attestation-hash-e2e",
      authorityOrder: [...CANONICAL_AUTHORITY_ORDER],
      sourcePath: "governance/ava007/AVA007_RUNTIME_GOVERNANCE.md",
      manifestPath: "governance/manifest.json",
      attestationPath: "governance/attestation.json",
      loadedAt: "2026-06-03T00:00:00.000Z",
    };

    const buildSnapshot = {
      runtimeVersion: "0.1.0",
      gitCommit: "5e300b0d9aa609a973e25420a884e30af88b070a",
      buildHash: "build-hash-e2e",
      buildTimestamp: "2026-06-03T00:00:00.000Z",
      worktreeDirty: true,
      manifestPath: "authority/build/buildManifest.json",
      loadedAt: "2026-06-03T00:00:00.000Z",
    };

    const deploymentSnapshot = {
      deploymentVersion: "1.0.0",
      deploymentHash: "deployment-hash-e2e",
      releaseId: "release-e2e",
      environment: "development",
      buildHash: buildSnapshot.buildHash,
      containerHash: "container-hash-e2e",
      deployedAt: "2026-06-03T00:00:00.000Z",
      manifestPath: "authority/deployment/deploymentManifest.json",
      loadedAt: "2026-06-03T00:00:00.000Z",
    };

    const runtimeSnapshot = {
      runtimeVersion: buildSnapshot.runtimeVersion,
      runtimeHash: "runtime-hash-e2e",
      deploymentHash: deploymentSnapshot.deploymentHash,
      buildHash: buildSnapshot.buildHash,
      processId: 4242,
      hostname: "runtime-host-e2e",
      nodeVersion: "v22.0.0",
      platform: "linux",
      startedAt: "2026-06-03T00:00:05.000Z",
    };

    const audit = new AuditEngine();
    const executive = new BasicExecutiveRuntime(
      audit,
      undefined,
      undefined,
      () => buildSnapshot,
      () => deploymentSnapshot,
      () => runtimeSnapshot,
    );

    const lineage = executive.recordDecisionWithLineage({
      decisionId: "decision-authority-e2e-1",
      memoryAtoms: ["mem-a1", "mem-a2"],
      graphNodes: ["graph-a1"],
      policiesApplied: ["policy-immutability", "policy-lineage-required"],
      policyRequestContext: {
        memoryContext: ["mem-a1", "mem-a2"],
        timelineContext: ["evt-a1"],
      },
      timelineEvents: ["evt-a1"],
      executivePlanId: "plan-authority-e2e-1",
      executionPath: ["reflex", "executive"],
    });

    expect(lineage.finalPolicyOutcome).toBe("allow");

    const auditRecords = audit.list();
    expect(auditRecords).toHaveLength(1);

    const decision = auditRecords[0];
    expect(decision.decisionHash).toBe(lineage.decisionHash);
    expect(decision.runtimeVersion).toBe(buildSnapshot.runtimeVersion);
    expect(decision.gitCommit).toBe(buildSnapshot.gitCommit);
    expect(decision.buildHash).toBe(buildSnapshot.buildHash);
    expect(decision.buildTimestamp).toBe(buildSnapshot.buildTimestamp);
    expect(decision.worktreeDirty).toBe(buildSnapshot.worktreeDirty);
    expect(decision.deploymentVersion).toBe(deploymentSnapshot.deploymentVersion);
    expect(decision.deploymentHash).toBe(deploymentSnapshot.deploymentHash);
    expect(decision.runtimeHash).toBe(runtimeSnapshot.runtimeHash);
    expect(decision.runtimeStartedAt).toBe(runtimeSnapshot.startedAt);
    expect(decision.runtimeHost).toBe(runtimeSnapshot.hostname);

    const decisions = new Map<string, DecisionRecord>([[decision.decisionId, decision]]);
    const lineages = new Map<string, DecisionLineage>([[lineage.decisionId, lineage]]);

    const loadDecision = async (decisionId: string) => decisions.get(decisionId) ?? null;
    const loadLineage = async (lineageId: string) => lineages.get(lineageId) ?? null;
    const loadMemoryReference = async (id: string) => (lineage.memoryAtoms.includes(id) ? { id } : null);
    const loadGraphReference = async (id: string) => (lineage.graphNodes.includes(id) ? { id } : null);
    const loadTimelineReference = async (id: string) => (lineage.timelineEvents.includes(id) ? { id } : null);
    const loadPolicyReference = async (id: string) => (lineage.policiesApplied.includes(id) ? { id } : null);

    const serviceA = new AuthorityReplayService({
      loadDecision,
      loadLineage,
      loadMemoryReference,
      loadGraphReference,
      loadTimelineReference,
      loadPolicyReference,
      listDecisionIdsBySession: async () => [decision.decisionId],
      listDecisionIdsByLineage: async () => [decision.decisionId],
      listDecisionIdsByRange: async () => [decision.decisionId],
      replayRepository,
      graphRepository,
      loadGovernanceSnapshot: async () => ({ ...governanceSnapshot }),
      loadBuildSnapshot: () => ({ ...buildSnapshot }),
      loadDeploymentSnapshot: () => ({ ...deploymentSnapshot }),
      loadRuntimeSnapshot: () => ({ ...runtimeSnapshot }),
    });

    const firstReplay = await serviceA.replay(decision.decisionId);
    expect(firstReplay.status).toBe("VERIFIED");

    const serviceB = new AuthorityReplayService({
      loadDecision,
      loadLineage,
      loadMemoryReference,
      loadGraphReference,
      loadTimelineReference,
      loadPolicyReference,
      listDecisionIdsBySession: async () => [decision.decisionId],
      listDecisionIdsByLineage: async () => [decision.decisionId],
      listDecisionIdsByRange: async () => [decision.decisionId],
      replayRepository,
      graphRepository,
      loadGovernanceSnapshot: async () => ({ ...governanceSnapshot }),
      loadBuildSnapshot: () => ({ ...buildSnapshot }),
      loadDeploymentSnapshot: () => ({ ...deploymentSnapshot }),
      loadRuntimeSnapshot: () => ({ ...runtimeSnapshot }),
    });

    const secondReplay = await serviceB.replay(decision.decisionId);
    expect(secondReplay.status).toBe("VERIFIED");

    const persisted = await serviceB.listReplayRecords();
    expect(persisted).toHaveLength(2);
    expect(persisted.every((record) => record.governanceVersion === governanceSnapshot.governanceVersion)).toBe(true);
    expect(persisted.every((record) => record.governanceHash === governanceSnapshot.governanceHash)).toBe(true);
    expect(persisted.every((record) => record.manifestHash === governanceSnapshot.manifestHash)).toBe(true);
    expect(persisted.every((record) => record.attestationHash === governanceSnapshot.attestationHash)).toBe(true);
    expect(persisted.every((record) => record.runtimeVersion === buildSnapshot.runtimeVersion)).toBe(true);
    expect(persisted.every((record) => record.runtimeHash === runtimeSnapshot.runtimeHash)).toBe(true);
    expect(persisted.every((record) => record.runtimeStartedAt === runtimeSnapshot.startedAt)).toBe(true);
    expect(persisted.every((record) => record.runtimeHost === runtimeSnapshot.hostname)).toBe(true);
    expect(persisted.every((record) => record.gitCommit === buildSnapshot.gitCommit)).toBe(true);
    expect(persisted.every((record) => record.buildHash === buildSnapshot.buildHash)).toBe(true);
    expect(persisted.every((record) => record.buildTimestamp === buildSnapshot.buildTimestamp)).toBe(true);
    expect(persisted.every((record) => record.worktreeDirty === buildSnapshot.worktreeDirty)).toBe(true);
    expect(persisted.every((record) => record.deploymentVersion === deploymentSnapshot.deploymentVersion)).toBe(true);
    expect(persisted.every((record) => record.deploymentHash === deploymentSnapshot.deploymentHash)).toBe(true);
    expect(persisted.every((record) => record.releaseId === deploymentSnapshot.releaseId)).toBe(true);
    expect(persisted.every((record) => record.environment === deploymentSnapshot.environment)).toBe(true);
    expect(persisted.every((record) => record.authorityOrder.join(">") === CANONICAL_AUTHORITY_ORDER.join(">"))).toBe(
      true,
    );
    expect(persisted.every((record) => record.proof.algorithm === "sha256")).toBe(true);
    expect(persisted.every((record) => record.signature.algorithm === "ed25519")).toBe(true);
    expect(persisted.every((record) => record.signature.authorityId === "ava007-authority-v1")).toBe(true);
    expect(persisted.every((record) => record.signature.signerId === "ava007-authority-v1")).toBe(true);
    expect(persisted.every((record) => record.signature.signatureId.length > 0)).toBe(true);

    const decisionContext = await graphRepository.getContext(decision.decisionId);
    const replayEdges = decisionContext.outgoing.filter((relationship) => relationship.type === "REPLAYED");
    const replayNodeIds = replayEdges.map((relationship) => relationship.toId);

    expect(replayNodeIds).toContain(firstReplay.reportId);
    expect(replayNodeIds).toContain(secondReplay.reportId);

    const firstReplayNode = await graphRepository.getNode(firstReplay.reportId);
    const secondReplayNode = await graphRepository.getNode(secondReplay.reportId);

    expect(firstReplayNode?.properties.governanceVersion).toBe(governanceSnapshot.governanceVersion);
    expect(secondReplayNode?.properties.governanceVersion).toBe(governanceSnapshot.governanceVersion);
    expect(firstReplayNode?.properties.governanceHash).toBe(governanceSnapshot.governanceHash);
    expect(secondReplayNode?.properties.governanceHash).toBe(governanceSnapshot.governanceHash);
    expect(firstReplayNode?.properties.manifestHash).toBe(governanceSnapshot.manifestHash);
    expect(secondReplayNode?.properties.manifestHash).toBe(governanceSnapshot.manifestHash);
    expect(firstReplayNode?.properties.attestationHash).toBe(governanceSnapshot.attestationHash);
    expect(secondReplayNode?.properties.attestationHash).toBe(governanceSnapshot.attestationHash);
    expect(firstReplayNode?.properties.runtimeVersion).toBe(buildSnapshot.runtimeVersion);
    expect(secondReplayNode?.properties.runtimeVersion).toBe(buildSnapshot.runtimeVersion);
    expect(firstReplayNode?.properties.runtimeHash).toBe(runtimeSnapshot.runtimeHash);
    expect(secondReplayNode?.properties.runtimeHash).toBe(runtimeSnapshot.runtimeHash);
    expect(firstReplayNode?.properties.runtimeStartedAt).toBe(runtimeSnapshot.startedAt);
    expect(secondReplayNode?.properties.runtimeStartedAt).toBe(runtimeSnapshot.startedAt);
    expect(firstReplayNode?.properties.runtimeHost).toBe(runtimeSnapshot.hostname);
    expect(secondReplayNode?.properties.runtimeHost).toBe(runtimeSnapshot.hostname);
    expect(firstReplayNode?.properties.gitCommit).toBe(buildSnapshot.gitCommit);
    expect(secondReplayNode?.properties.gitCommit).toBe(buildSnapshot.gitCommit);
    expect(firstReplayNode?.properties.buildHash).toBe(buildSnapshot.buildHash);
    expect(secondReplayNode?.properties.buildHash).toBe(buildSnapshot.buildHash);
    expect(firstReplayNode?.properties.buildTimestamp).toBe(buildSnapshot.buildTimestamp);
    expect(secondReplayNode?.properties.buildTimestamp).toBe(buildSnapshot.buildTimestamp);
    expect(firstReplayNode?.properties.worktreeDirty).toBe(buildSnapshot.worktreeDirty);
    expect(secondReplayNode?.properties.worktreeDirty).toBe(buildSnapshot.worktreeDirty);
    expect(firstReplayNode?.properties.deploymentVersion).toBe(deploymentSnapshot.deploymentVersion);
    expect(secondReplayNode?.properties.deploymentVersion).toBe(deploymentSnapshot.deploymentVersion);
    expect(firstReplayNode?.properties.deploymentHash).toBe(deploymentSnapshot.deploymentHash);
    expect(secondReplayNode?.properties.deploymentHash).toBe(deploymentSnapshot.deploymentHash);
    expect(firstReplayNode?.properties.releaseId).toBe(deploymentSnapshot.releaseId);
    expect(secondReplayNode?.properties.releaseId).toBe(deploymentSnapshot.releaseId);
    expect(firstReplayNode?.properties.environment).toBe(deploymentSnapshot.environment);
    expect(secondReplayNode?.properties.environment).toBe(deploymentSnapshot.environment);
    expect(firstReplayNode?.properties.status).toBe("VERIFIED");
    expect(secondReplayNode?.properties.status).toBe("VERIFIED");
    expect(firstReplayNode?.properties.signatureAlgorithm).toBe("ed25519");
    expect(secondReplayNode?.properties.signatureAlgorithm).toBe("ed25519");
    expect(firstReplayNode?.properties.signatureAuthorityId).toBe("ava007-authority-v1");
    expect(secondReplayNode?.properties.signatureAuthorityId).toBe("ava007-authority-v1");
    expect(firstReplayNode?.properties.signatureSignerId).toBe("ava007-authority-v1");
    expect(secondReplayNode?.properties.signatureSignerId).toBe("ava007-authority-v1");
    expect(typeof firstReplayNode?.properties.signatureArtifactHash).toBe("string");
    expect(typeof secondReplayNode?.properties.signatureArtifactHash).toBe("string");
    expect(decision.runtimeHash).toBe(persisted[0].runtimeHash);
    expect(persisted[0].runtimeHash).toBe(firstReplayNode?.properties.runtimeHash as string);

    const reconstructor = new DecisionReconstructor();
    const reconstruction = await reconstructor.reconstruct(lineage.decisionId, {
      loadLineage,
      loadMemoryAtom: loadMemoryReference,
      loadGraphNode: loadGraphReference,
      loadPolicy: loadPolicyReference,
      loadTimelineEvent: loadTimelineReference,
    });

    expect(reconstruction.hashMatch).toBe(true);
    expect(reconstruction.policyOutcomeConsistent).toBe(true);

    const replayRecordForValidation: AuthorityReplayRecord = {
      decisionId: decision.decisionId,
      lineageId: lineage.decisionId,
      authorityOrder: [...governanceSnapshot.authorityOrder],
      memoryReferences: [...lineage.memoryAtoms],
      graphReferences: [...lineage.graphNodes],
      timelineReferences: [...lineage.timelineEvents],
      policyReferences: [...lineage.policiesApplied],
      finalPolicyOutcome: lineage.finalPolicyOutcome,
      storedDecisionHash: decision.decisionHash ?? "missing_stored_hash",
      reconstructedDecisionHash: reconstruction.reconstructedHash,
      hashMatch: decision.decisionHash === reconstruction.reconstructedHash,
      policyMatch: reconstruction.policyOutcomeConsistent,
      referencesValid: true,
      reconstructionMatch:
        decision.decisionHash === reconstruction.reconstructedHash && reconstruction.policyOutcomeConsistent,
      timestamp: lineage.timestamp,
    };

    const validation = await validateAuthorityReplayRecord(
      replayRecordForValidation,
      {
        loadLineage,
        loadMemoryReference,
        loadGraphReference,
        loadTimelineReference,
        loadPolicyReference,
      },
      {
        expectedDecisionId: decision.decisionId,
        expectedLineageId: lineage.decisionId,
      },
    );

    const report = buildReplayReport(replayRecordForValidation, validation);

    expect(validation.status).toBe("VERIFIED");
    expect(validation.issues).toEqual([]);
    expect(report.status).toBe("VERIFIED");
    expect(report.hashMatch).toBe(true);
    expect(report.policyMatch).toBe(true);
    expect(report.referencesValid).toBe(true);
    expect(report.authorityOrderValid).toBe(true);
    expect(report.issues).toEqual([]);
  });
});
