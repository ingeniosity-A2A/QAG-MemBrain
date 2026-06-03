import { describe, expect, it } from "vitest";
import { buildCanonicalReplayArtifactRoot, generateEd25519KeyPair, signReplayArtifact } from "../../authority/signing/signer.js";
import { verifyReplayArtifactSignature } from "../../authority/signing/verifier.js";

describe("Replay artifact signer", () => {
  it("signs canonical replay artifact root with ed25519", () => {
    const keys = generateEd25519KeyPair();
    const payload = buildCanonicalReplayArtifactRoot({
      replayHash: "replay-hash-1",
      runtimeHash: "runtime-hash-1",
      deploymentHash: "deployment-hash-1",
      buildHash: "build-hash-1",
      governanceHash: "governance-hash-1",
      manifestHash: "manifest-hash-1",
      attestationHash: "attestation-hash-1",
      decisionId: "decision-1",
      lineageId: "lineage-1",
      timestamp: "2026-06-03T00:00:00.000Z",
    });

    const signatureRecord = signReplayArtifact(payload, {
      authorityId: "ava007-authority-v1",
      signerId: "ava007-authority",
      privateKey: keys.privateKey,
      publicKey: keys.publicKey,
    });

    expect(signatureRecord.algorithm).toBe("ed25519");
    expect(signatureRecord.authorityId).toBe("ava007-authority-v1");
    expect(signatureRecord.signerId).toBe("ava007-authority");
    expect(signatureRecord.signatureId.length).toBeGreaterThan(0);
    expect(signatureRecord.signature.length).toBeGreaterThan(0);
    expect(verifyReplayArtifactSignature(payload, signatureRecord)).toBe(true);
  });
});
