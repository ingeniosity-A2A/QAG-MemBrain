import { createPrivateKey, sign as signBuffer } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildCanonicalReplayArtifactRoot, generateEd25519KeyPair, signReplayArtifact } from "../../authority/signing/signer.js";
import { AuthoritySigner } from "../../authority/signing/authoritySigner.js";
import { verifyReplayArtifactSignature } from "../../authority/signing/verifier.js";
import { AuthorityKeyDescriptor } from "../../authority/signing/keyStore.js";

function buildPayload() {
  return buildCanonicalReplayArtifactRoot({
    replayHash: "replay-hash-signer-matrix-1",
    runtimeHash: "runtime-hash-signer-matrix-1",
    deploymentHash: "deployment-hash-signer-matrix-1",
    buildHash: "build-hash-signer-matrix-1",
    governanceHash: "governance-hash-signer-matrix-1",
    manifestHash: "manifest-hash-signer-matrix-1",
    attestationHash: "attestation-hash-signer-matrix-1",
    decisionId: "decision-signer-matrix-1",
    lineageId: "lineage-signer-matrix-1",
    timestamp: "2026-06-03T00:00:00.000Z",
  });
}

function buildMockExternalSigner(input: {
  backend: "kms" | "hsm";
  authorityId: string;
  signerId: string;
  privateKeyPem: string;
  publicKeyPem: string;
}): AuthoritySigner {
  return {
    backend: input.backend,
    algorithm: "ed25519",
    getAuthorityId(): string {
      return input.authorityId;
    },
    getSignerId(): string {
      return input.signerId;
    },
    getPublicKey(): string {
      return input.publicKeyPem;
    },
    sign(data: Uint8Array): string {
      const privateKey = createPrivateKey(input.privateKeyPem);
      return signBuffer(null, data, privateKey).toString("base64");
    },
  };
}

describe("AuthoritySigner backend equivalence", () => {
  it("produces verifiable signatures for local, kms-mock, and hsm-mock signers", () => {
    const local = generateEd25519KeyPair();
    const kms = generateEd25519KeyPair();
    const hsm = generateEd25519KeyPair();
    const payload = buildPayload();

    const cases: Array<{
      signer: AuthoritySigner;
      authority: AuthorityKeyDescriptor;
    }> = [
      {
        signer: buildMockExternalSigner({
          backend: "kms",
          authorityId: "ava007-authority-kms-v1",
          signerId: "ava007-authority-kms-v1",
          privateKeyPem: kms.privateKey,
          publicKeyPem: kms.publicKey,
        }),
        authority: {
          authorityId: "ava007-authority-kms-v1",
          algorithm: "ed25519",
          publicKey: kms.publicKey,
          createdAt: "2026-06-03T00:00:00.000Z",
          validFrom: "2026-06-03T00:00:00.000Z",
          status: "active",
        },
      },
      {
        signer: buildMockExternalSigner({
          backend: "hsm",
          authorityId: "ava007-authority-hsm-v1",
          signerId: "ava007-authority-hsm-v1",
          privateKeyPem: hsm.privateKey,
          publicKeyPem: hsm.publicKey,
        }),
        authority: {
          authorityId: "ava007-authority-hsm-v1",
          algorithm: "ed25519",
          publicKey: hsm.publicKey,
          createdAt: "2026-06-03T00:00:00.000Z",
          validFrom: "2026-06-03T00:00:00.000Z",
          status: "active",
        },
      },
      {
        signer: {
          backend: "local",
          algorithm: "ed25519",
          getAuthorityId(): string {
            return "ava007-authority-local-v1";
          },
          getSignerId(): string {
            return "ava007-authority-local-v1";
          },
          getPublicKey(): string {
            return local.publicKey;
          },
          sign(data: Uint8Array): string {
            const privateKey = createPrivateKey(local.privateKey);
            return signBuffer(null, data, privateKey).toString("base64");
          },
        },
        authority: {
          authorityId: "ava007-authority-local-v1",
          algorithm: "ed25519",
          publicKey: local.publicKey,
          createdAt: "2026-06-03T00:00:00.000Z",
          validFrom: "2026-06-03T00:00:00.000Z",
          status: "active",
        },
      },
    ];

    for (const entry of cases) {
      const signature = signReplayArtifact(payload, entry.signer);

      expect(
        verifyReplayArtifactSignature(payload, signature, {
          strictAuthorityVerification: true,
          resolveAuthority: (authorityId) =>
            authorityId === entry.authority.authorityId ? entry.authority : null,
          isAuthorityValidAt: (authorityId, signedAt) =>
            authorityId === entry.authority.authorityId && Date.parse(signedAt) >= Date.parse(entry.authority.validFrom),
          resolvePublicKey: (authorityId) =>
            authorityId === entry.authority.authorityId ? entry.authority.publicKey : null,
        }),
      ).toBe(true);
    }
  });
});
