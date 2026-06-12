import { describe, expect, it } from "vitest";
import { AuditEngine } from "../../audit/decisions/decisionRecord.js";

describe("Audit signature provenance", () => {
  it("retains signature metadata in audit decision records", () => {
    const audit = new AuditEngine();

    audit.append({
      decisionId: "decision-audit-signature-1",
      memories: ["m1"],
      policies: ["p1"],
      relationships: ["g1"],
      timestamp: "2026-06-03T00:00:00.000Z",
      executionPath: ["reflex", "executive"],
      signatureId: "signature-id-1",
      signature: "base64-signature",
      signatureAlgorithm: "ed25519",
      signatureSignedAt: "2026-06-03T00:00:01.000Z",
      authorityId: "ava007-authority-v1",
      signerId: "ava007-authority",
      signatureArtifactHash: "artifact-hash-1",
    });

    const records = audit.list();
    expect(records).toHaveLength(1);
    expect(records[0].signatureId).toBe("signature-id-1");
    expect(records[0].signatureAlgorithm).toBe("ed25519");
    expect(records[0].authorityId).toBe("ava007-authority-v1");
    expect(records[0].signerId).toBe("ava007-authority");
    expect(records[0].signatureArtifactHash).toBe("artifact-hash-1");
  });
});