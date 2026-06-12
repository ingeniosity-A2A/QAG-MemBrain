import { describe, expect, it } from "vitest";
import { AuditEngine } from "../../audit/decisions/decisionRecord.js";
import { BasicExecutiveRuntime } from "../../brain/executive/runtime.js";

describe("Lineage and audit integration", () => {
  it("writes audit records that reference lineage", async () => {
    const audit = new AuditEngine();
    const executive = new BasicExecutiveRuntime(
      audit,
      undefined,
      undefined,
      () => ({
        runtimeVersion: "0.1.0",
        gitCommit: "5e300b0d9aa609a973e25420a884e30af88b070a",
        buildHash: "build-hash-audit",
        buildTimestamp: "2026-06-03T00:00:00.000Z",
        worktreeDirty: true,
        manifestPath: "authority/build/buildManifest.json",
        loadedAt: "2026-06-03T00:00:00.000Z",
      }),
      () => ({
        deploymentVersion: "1.0.0",
        deploymentHash: "deployment-hash-audit",
        releaseId: "release-audit",
        environment: "development",
        buildHash: "build-hash-audit",
        containerHash: "container-hash-audit",
        deployedAt: "2026-06-03T00:00:00.000Z",
        manifestPath: "authority/deployment/deploymentManifest.json",
        loadedAt: "2026-06-03T00:00:00.000Z",
      }),
    );

    const lineage = executive.recordDecisionWithLineage({
      decisionId: "decision-audit-1",
      memoryAtoms: ["m1", "m2"],
      graphNodes: ["node1", "node2"],
      policiesApplied: ["policy-immutability"],
      policyRequestContext: {
        memoryContext: ["m1", "m2"],
      },
      timelineEvents: ["evt-1"],
      executivePlanId: "plan-77",
      executionPath: ["reflex", "executive"],
    });

    const records = audit.list();
    expect(records).toHaveLength(1);
    expect(records[0].lineageId).toBe(lineage.decisionId);
    expect(records[0].decisionHash).toBe(lineage.decisionHash);
    expect(records[0].runtimeVersion).toBe("0.1.0");
    expect(records[0].gitCommit).toBe("5e300b0d9aa609a973e25420a884e30af88b070a");
    expect(records[0].buildHash).toBe("build-hash-audit");
    expect(records[0].buildTimestamp).toBe("2026-06-03T00:00:00.000Z");
    expect(records[0].worktreeDirty).toBe(true);
    expect(records[0].deploymentVersion).toBe("1.0.0");
    expect(records[0].deploymentHash).toBe("deployment-hash-audit");
    expect(records[0].memories).toEqual(["m1", "m2"]);
    expect(lineage.policyEvaluations).toHaveLength(1);
    expect(lineage.policyEvaluations[0].result).toBe("allow");
    expect(lineage.policyResults).toContain("allow");
    expect(lineage.policyEvidence).toContain("m1");
    expect(lineage.finalPolicyOutcome).toBe("allow");
  });
});
