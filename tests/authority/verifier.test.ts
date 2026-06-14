import { describe, expect, it } from "vitest";
import { buildCanonicalReplayArtifactRoot, generateEd25519KeyPair, signReplayArtifact } from "../../authority/signing/signer.js";
import { verifyReplayArtifactSignature } from "../../authority/signing/verifier.js";

describe("Replay artifact verifier", () => {
  it("fails verification when canonical payload is tampered", () => {
    const keys = generateEd25519KeyPair();
    const payload = buildCanonicalReplayArtifactRoot({
      replayHash: "replay-hash-2",
      runtimeHash: "runtime-hash-2",
      deploymentHash: "deployment-hash-2",
      buildHash: "build-hash-2",
      governanceHash: "governance-hash-2",
      manifestHash: "manifest-hash-2",
      attestationHash: "attestation-hash-2",
      decisionId: "decision-2",
      lineageId: "lineage-2",
      timestamp: "2026-06-03T00:01:00.000Z",
    });

    const signatureRecord = signReplayArtifact(payload, {
      authorityId: "ava007-authority-v1",
      signerId: "ava007-authority",
      privateKey: keys.privateKey,
      publicKey: keys.publicKey,
    });

    const tampered = buildCanonicalReplayArtifactRoot({
      ...payload,
      governanceHash: "governance-hash-tampered",
    });

    expect(verifyReplayArtifactSignature(tampered, signatureRecord)).toBe(false);
  });
});
