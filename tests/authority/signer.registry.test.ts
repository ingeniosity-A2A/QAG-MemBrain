import { describe, expect, it } from "vitest";
import { rotateAuthorityKeyInMemory } from "../../authority/signing/keyRotation.js";
import { AuthorityKeyManifest, TrustedAuthoritiesDocument } from "../../authority/signing/keyStore.js";
import { buildAuthoritySignerRegistry } from "../../authority/signing/signerRegistry.js";
import { buildCanonicalReplayArtifactRoot, generateEd25519KeyPair, signReplayArtifact } from "../../authority/signing/signer.js";
import { verifyReplayArtifactSignature } from "../../authority/signing/verifier.js";

function buildPayload() {
  return buildCanonicalReplayArtifactRoot({
    replayHash: "replay-hash-registry-1",
    runtimeHash: "runtime-hash-registry-1",
    deploymentHash: "deployment-hash-registry-1",
    buildHash: "build-hash-registry-1",
    governanceHash: "governance-hash-registry-1",
    manifestHash: "manifest-hash-registry-1",
    attestationHash: "attestation-hash-registry-1",
    decisionId: "decision-registry-1",
    lineageId: "lineage-registry-1",
    timestamp: "2026-06-03T00:00:00.000Z",
  });
}

describe("Authority signer registry", () => {
  it("verifies historical signatures after key rotation", () => {
    const v1Keys = generateEd25519KeyPair();
    const v2Keys = generateEd25519KeyPair();

    const manifest: AuthorityKeyManifest = {
      authorityId: "ava007-authority-v1",
      algorithm: "ed25519",
      publicKey: v1Keys.publicKey,
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
      publicKey: v2Keys.publicKey,
      reason: "scheduled-rotation",
      rotatedAt: "2026-07-01T00:00:00.000Z",
    });

    const registry = buildAuthoritySignerRegistry(rotated.manifest, rotated.trustedAuthorities);
    const payload = buildPayload();

    const historicalSignature = signReplayArtifact(payload, {
      authorityId: "ava007-authority-v1",
      signerId: "ava007-authority-v1",
      privateKey: v1Keys.privateKey,
      publicKey: v1Keys.publicKey,
    });

    expect(
      verifyReplayArtifactSignature(payload, historicalSignature, {
        strictAuthorityVerification: true,
        resolveAuthority: registry.resolveAuthority,
        isAuthorityValidAt: registry.isAuthorityValidAt,
        resolvePublicKey: registry.resolvePublicKey,
      }),
    ).toBe(true);
  });

  it("fails verification when authority is revoked and no embedded public key exists", () => {
    const v1Keys = generateEd25519KeyPair();

    const manifest: AuthorityKeyManifest = {
      authorityId: "ava007-authority-v1",
      algorithm: "ed25519",
      publicKey: v1Keys.publicKey,
      createdAt: "2026-06-03T00:00:00.000Z",
      validFrom: "2026-06-03T00:00:00.000Z",
      status: "active",
    };

    const trusted: TrustedAuthoritiesDocument = {
      updatedAt: "2026-06-03T00:00:00.000Z",
      authorities: [
        {
          ...manifest,
          status: "revoked",
          revokedAt: "2026-08-01T00:00:00.000Z",
        },
      ],
    };

    const payload = buildPayload();
    const signature = signReplayArtifact(payload, {
      authorityId: "ava007-authority-v1",
      signerId: "ava007-authority-v1",
      privateKey: v1Keys.privateKey,
      publicKey: v1Keys.publicKey,
    });

    const withoutEmbeddedPublicKey = {
      ...signature,
      publicKey: undefined,
    };

    expect(
      verifyReplayArtifactSignature(payload, withoutEmbeddedPublicKey, {
        resolvePublicKey: (authorityId) => {
          const authority = trusted.authorities.find((entry) => entry.authorityId === authorityId);
          return authority && authority.status !== "revoked" ? authority.publicKey : null;
        },
      }),
    ).toBe(false);
  });
});
