import { describe, expect, it } from "vitest";
import { rotateAuthorityKeyInMemory } from "../../authority/signing/keyRotation.js";
import { AuthorityKeyManifest, TrustedAuthoritiesDocument } from "../../authority/signing/keyStore.js";
import { buildAuthoritySignerRegistry } from "../../authority/signing/signerRegistry.js";
import { buildCanonicalReplayArtifactRoot, generateEd25519KeyPair, signReplayArtifact } from "../../authority/signing/signer.js";
import { verifyReplayArtifactSignature } from "../../authority/signing/verifier.js";

function payload() {
  return buildCanonicalReplayArtifactRoot({
    replayHash: "replay-hash-historical-1",
    runtimeHash: "runtime-hash-historical-1",
    deploymentHash: "deployment-hash-historical-1",
    buildHash: "build-hash-historical-1",
    governanceHash: "governance-hash-historical-1",
    manifestHash: "manifest-hash-historical-1",
    attestationHash: "attestation-hash-historical-1",
    decisionId: "decision-historical-1",
    lineageId: "lineage-historical-1",
    timestamp: "2026-06-03T00:00:00.000Z",
  });
}

describe("Historical authority verification", () => {
  it("allows retired keys for historical signatures and rejects post-validity signatures", () => {
    const v1 = generateEd25519KeyPair();
    const v2 = generateEd25519KeyPair();
    const v3 = generateEd25519KeyPair();

    const manifest: AuthorityKeyManifest = {
      authorityId: "ava007-authority-v1",
      algorithm: "ed25519",
      publicKey: v1.publicKey,
      createdAt: "2026-06-03T00:00:00.000Z",
      validFrom: "2026-06-03T00:00:00.000Z",
      status: "active",
    };

    const trusted: TrustedAuthoritiesDocument = {
      updatedAt: "2026-06-03T00:00:00.000Z",
      authorities: [{ ...manifest }],
    };

    const rotated = rotateAuthorityKeyInMemory(manifest, trusted, {
      authorityId: "ava007-authority-v2",
      publicKey: v2.publicKey,
      reason: "scheduled-rotation",
      rotatedAt: "2026-07-01T00:00:00.000Z",
    });

    const registry = buildAuthoritySignerRegistry(rotated.manifest, rotated.trustedAuthorities);

    const historicalSignature = {
      ...signReplayArtifact(payload(), {
        authorityId: "ava007-authority-v1",
        signerId: "ava007-authority-v1",
        privateKey: v1.privateKey,
        publicKey: v1.publicKey,
      }),
      signedAt: "2026-06-15T00:00:00.000Z",
      publicKey: undefined,
    };

    const futureSignature = {
      ...signReplayArtifact(payload(), {
        authorityId: "ava007-authority-v1",
        signerId: "ava007-authority-v1",
        privateKey: v1.privateKey,
        publicKey: v1.publicKey,
      }),
      signedAt: "2026-08-01T00:00:00.000Z",
      publicKey: undefined,
    };

    expect(
      verifyReplayArtifactSignature(payload(), historicalSignature, {
        resolveAuthority: registry.resolveAuthority,
        isAuthorityValidAt: registry.isAuthorityValidAt,
        resolvePublicKey: registry.resolvePublicKey,
        strictAuthorityVerification: true,
      }),
    ).toBe(true);

    expect(
      verifyReplayArtifactSignature(payload(), futureSignature, {
        resolveAuthority: registry.resolveAuthority,
        isAuthorityValidAt: registry.isAuthorityValidAt,
        resolvePublicKey: registry.resolvePublicKey,
        strictAuthorityVerification: true,
      }),
    ).toBe(false);

    const futureAuthoritySignature = {
      ...signReplayArtifact(payload(), {
        authorityId: "ava007-authority-v3",
        signerId: "ava007-authority-v3",
        privateKey: v3.privateKey,
        publicKey: v3.publicKey,
      }),
      signedAt: "2026-06-15T00:00:00.000Z",
      publicKey: undefined,
    };

    expect(
      verifyReplayArtifactSignature(payload(), futureAuthoritySignature, {
        resolveAuthority: registry.resolveAuthority,
        isAuthorityValidAt: registry.isAuthorityValidAt,
        resolvePublicKey: registry.resolvePublicKey,
        strictAuthorityVerification: true,
      }),
    ).toBe(false);
  });
});
