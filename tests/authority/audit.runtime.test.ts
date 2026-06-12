import { describe, expect, it } from "vitest";
import { AuditEngine } from "../../audit/decisions/decisionRecord.js";
import { BasicExecutiveRuntime } from "../../brain/executive/runtime.js";

describe("Audit runtime provenance", () => {
  it("writes runtime identity fields into decision audit records", () => {
    const audit = new AuditEngine();
    const runtimeSnapshot = {
      runtimeVersion: "0.1.0",
      runtimeHash: "runtime-hash-audit",
      deploymentHash: "deployment-hash-audit",
      buildHash: "build-hash-audit",
      processId: 8080,
      hostname: "audit-host",
      nodeVersion: "v22.0.0",
      platform: "linux",
      startedAt: "2026-06-03T00:00:00.000Z",
    };

    const runtime = new BasicExecutiveRuntime(
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
      () => runtimeSnapshot,
    );

    runtime.recordDecision("decision-runtime-audit", ["m1"], ["g1"]);

    const records = audit.list();
    expect(records).toHaveLength(1);
    expect(records[0].runtimeHash).toBe("runtime-hash-audit");
    expect(records[0].runtimeStartedAt).toBe("2026-06-03T00:00:00.000Z");
    expect(records[0].runtimeHost).toBe("audit-host");
  });
});
