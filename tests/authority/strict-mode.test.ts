import { describe, expect, it } from "vitest";
import { buildCanonicalReplayArtifactRoot, generateEd25519KeyPair, signReplayArtifact } from "../../authority/signing/signer.js";
import { verifyReplayArtifactSignature } from "../../authority/signing/verifier.js";

function payload() {
  return buildCanonicalReplayArtifactRoot({
    replayHash: "replay-hash-strict-1",
    runtimeHash: "runtime-hash-strict-1",
    deploymentHash: "deployment-hash-strict-1",
    buildHash: "build-hash-strict-1",
    governanceHash: "governance-hash-strict-1",
    manifestHash: "manifest-hash-strict-1",
    attestationHash: "attestation-hash-strict-1",
    decisionId: "decision-strict-1",
    lineageId: "lineage-strict-1",
    timestamp: "2026-06-03T00:00:00.000Z",
  });
}

describe("Strict authority verification mode", () => {
  it("rejects unknown authority IDs even when embedded key is present", () => {
    const keys = generateEd25519KeyPair();
    const signature = signReplayArtifact(payload(), {
      authorityId: "unknown-authority",
      signerId: "unknown-authority",
      privateKey: keys.privateKey,
      publicKey: keys.publicKey,
    });

    expect(verifyReplayArtifactSignature(payload(), signature)).toBe(false);
  });

  it("blocks embedded-key fallback when strict mode is enabled", () => {
    const keys = generateEd25519KeyPair();
    const signed = signReplayArtifact(payload(), {
      authorityId: "ava007-authority-v1",
      signerId: "ava007-authority-v1",
      privateKey: keys.privateKey,
      publicKey: keys.publicKey,
    });

    const legacySignature = {
      ...signed,
      authorityId: undefined,
      signerId: "legacy-signer",
    };

    expect(verifyReplayArtifactSignature(payload(), legacySignature, { strictAuthorityVerification: false })).toBe(true);
    expect(verifyReplayArtifactSignature(payload(), legacySignature, { strictAuthorityVerification: true })).toBe(false);
  });
});
