import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DecisionRecord } from "../../audit/decisions/decisionRecord.js";
import { JsonlReplayRepository } from "../../authority/persistence/replayRepository.js";
import { AuthorityReplayService } from "../../authority/service/authorityReplayService.js";
import { loadAuthoritySignerRegistry } from "../../authority/signing/signerRegistry.js";
import { computeDecisionHash } from "../../lineage/hashing/decisionHash.js";
import { DecisionLineage, DecisionLineageInput } from "../../lineage/schemas/decisionLineage.js";

const cleanupTargets: string[] = [];

afterEach(async () => {
  while (cleanupTargets.length > 0) {
    const path = cleanupTargets.pop();
    if (path) {
      await rm(path, { recursive: true, force: true });
    }
  }
});

function buildLineage(decisionId = "decision-persist-1"): DecisionLineage {
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
        timestamp: "2026-06-03T10:00:00.000Z",
      },
    ],
    policyResults: ["allow"],
    policyEvidence: ["mem-1"],
    finalPolicyOutcome: "allow",
    timelineEvents: ["time-1"],
    executivePlanId: "plan-1",
    timestamp: "2026-06-03T10:00:00.000Z",
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
    timestamp: input.timestamp ?? "2026-06-03T10:00:00.000Z",
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
  decision: DecisionRecord,
  lineage: DecisionLineage,
  replayRepository: JsonlReplayRepository,
): AuthorityReplayService {
  return new AuthorityReplayService({
    loadDecision: async (decisionId) => (decisionId === decision.decisionId ? decision : null),
    loadLineage: async (lineageId) => (lineageId === lineage.decisionId ? lineage : null),
    loadMemoryReference: async (id) => ({ id }),
    loadGraphReference: async (id) => ({ id }),
    loadTimelineReference: async (id) => ({ id }),
    loadPolicyReference: async (id) => ({ id }),
    listDecisionIdsBySession: async () => [decision.decisionId],
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
}

describe("Authority replay persistence", () => {
  it("keeps replay records after service restart", async () => {
    const activeAuthorityId = loadAuthoritySignerRegistry().activeAuthority.authorityId;
    const tempDir = await mkdtemp(join(tmpdir(), "qag-membrain-replay-"));
    cleanupTargets.push(tempDir);

    const replayLedgerPath = join(tempDir, "replay.jsonl");
    const replayRepository = new JsonlReplayRepository(replayLedgerPath);

    const lineage = buildLineage();
    const decision = buildDecision(lineage);

    const serviceA = buildService(decision, lineage, replayRepository);
    const response = await serviceA.replay(decision.decisionId);
    expect(response.status).toBe("VERIFIED");

    const serviceB = buildService(decision, lineage, replayRepository);
    const persisted = await serviceB.listReplayRecords();

    expect(persisted).toHaveLength(1);
    expect(persisted[0].decisionId).toBe(decision.decisionId);
    expect(persisted[0].status).toBe("VERIFIED");
    expect(persisted[0].failureReasons).toEqual([]);
    expect(persisted[0].governanceVersion).toBe("1.4");
    expect(persisted[0].governanceHash).toBe("gov-hash-test");
    expect(persisted[0].manifestHash).toBe("manifest-hash-test");
    expect(persisted[0].attestationHash).toBe("attestation-hash-test");
    expect(persisted[0].runtimeVersion).toBe("0.1.0");
    expect(persisted[0].gitCommit).toBe("5e300b0d9aa609a973e25420a884e30af88b070a");
    expect(persisted[0].buildHash).toBe("build-hash-test");
    expect(persisted[0].buildTimestamp).toBe("2026-06-03T00:00:00.000Z");
    expect(persisted[0].worktreeDirty).toBe(true);
    expect(persisted[0].deploymentVersion).toBe("1.0.0");
    expect(persisted[0].deploymentHash).toBe("deployment-hash-test");
    expect(persisted[0].releaseId).toBe("release-test");
    expect(persisted[0].environment).toBe("development");
    expect(persisted[0].authorityOrder).toEqual(["JSONL", "Tashi", "Neo4j", "GSAP", "Runtime"]);
    expect(persisted[0].replayHash.length).toBeGreaterThan(0);
    expect(persisted[0].proof).toEqual({ algorithm: "sha256" });
    expect(persisted[0].signature.algorithm).toBe("ed25519");
    expect(persisted[0].signature.authorityId).toBe(activeAuthorityId);
    expect(persisted[0].signature.signerId).toBe(activeAuthorityId);
    expect(persisted[0].signature.signatureId.length).toBeGreaterThan(0);
  });
});
