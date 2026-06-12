import { createPrivateKey, sign as signBuffer } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CANONICAL_AUTHORITY_ORDER } from "../../authority/replay/replayContract.js";
import { computeReplayHash } from "../../authority/persistence/replayHash.js";
import { ReplayRecord, ReplayRecordInput } from "../../authority/service/replayRecord.js";
import { buildCanonicalReplayArtifactRoot, generateEd25519KeyPair } from "../../authority/signing/signer.js";
import { computeReplayArtifactHash } from "../../authority/signing/signatureHash.js";
import { verifyReplayArtifactSignature } from "../../authority/signing/verifier.js";
import { AuthorityKeyDescriptor } from "../../authority/signing/keyStore.js";
import { verifyReplayArtifactRecord } from "../../authority/verification/verifyArtifact.js";

function buildReplayInput(): ReplayRecordInput {
  return {
    replayId: "rep-verify-1",
    decisionId: "decision-verify-1",
    lineageId: "lineage-verify-1",
    governanceVersion: "1.5",
    governanceHash: "gov-hash-1",
    manifestHash: "manifest-hash-1",
    attestationHash: "attestation-hash-1",
    runtimeVersion: "0.1.0",
    runtimeHash: "runtime-hash-1",
    runtimeStartedAt: "2026-06-03T00:00:00.000Z",
    runtimeHost: "verify-host",
    runtimeProcessId: 1001,
    runtimeNodeVersion: "v22.0.0",
    runtimePlatform: "linux",
    gitCommit: "5e300b0d9aa609a973e25420a884e30af88b070a",
    buildHash: "build-hash-1",
    buildTimestamp: "2026-06-03T00:00:00.000Z",
    worktreeDirty: true,
    deploymentVersion: "1.0.0",
    deploymentHash: "deployment-hash-1",
    releaseId: "release-1",
    environment: "development",
    status: "VERIFIED",
    failureReasons: [],
    authorityOrder: [...CANONICAL_AUTHORITY_ORDER],
    timestamp: "2026-06-03T00:00:01.000Z",
    startedAt: "2026-06-03T00:00:00.000Z",
    completedAt: "2026-06-03T00:00:01.000Z",
  };
}

function signRecord(
  input: ReplayRecordInput,
  authorityId: string,
  privateKeyPem: string,
  publicKeyPem: string,
  signedAt = "2026-06-03T00:01:00.000Z",
): ReplayRecord {
  const replayHash = computeReplayHash(input);
  const artifactRoot = buildCanonicalReplayArtifactRoot({
    replayHash,
    runtimeHash: input.runtimeHash,
    deploymentHash: input.deploymentHash,
    buildHash: input.buildHash,
    governanceHash: input.governanceHash,
    manifestHash: input.manifestHash,
    attestationHash: input.attestationHash,
    decisionId: input.decisionId,
    lineageId: input.lineageId,
    timestamp: input.timestamp,
  });

  const artifactHash = computeReplayArtifactHash(artifactRoot);
  const signature = signBuffer(
    null,
    Buffer.from(artifactHash, "utf8"),
    createPrivateKey(privateKeyPem),
  ).toString("base64");

  return {
    ...input,
    replayHash,
    proof: {
      algorithm: "sha256",
    },
    signature: {
      signatureId: "sig-verify-1",
      signature,
      algorithm: "ed25519",
      signedAt,
      authorityId,
      signerId: authorityId,
      artifactHash,
      publicKey: publicKeyPem,
    },
  };
}

function makeAuthority(
  authorityId: string,
  publicKey: string,
  status: "active" | "retired" | "revoked" = "active",
  validFrom = "2026-06-03T00:00:00.000Z",
  validUntil?: string,
): AuthorityKeyDescriptor {
  return {
    authorityId,
    algorithm: "ed25519",
    publicKey,
    createdAt: validFrom,
    validFrom,
    validUntil,
    status,
  };
}

async function verifyWithStubs(
  record: ReplayRecord,
  authority: AuthorityKeyDescriptor | null,
  overrides?: {
    governanceValid?: boolean;
    buildValid?: boolean;
    deploymentValid?: boolean;
    runtimeValid?: boolean;
  },
) {
  return verifyReplayArtifactRecord(record, "replay.json", {
    verifyReplay: (candidate) => {
      const root = buildCanonicalReplayArtifactRoot({
        replayHash: candidate.replayHash,
        runtimeHash: candidate.runtimeHash,
        deploymentHash: candidate.deploymentHash,
        buildHash: candidate.buildHash,
        governanceHash: candidate.governanceHash,
        manifestHash: candidate.manifestHash,
        attestationHash: candidate.attestationHash,
        decisionId: candidate.decisionId,
        lineageId: candidate.lineageId,
        timestamp: candidate.timestamp,
      });

      const authorityId = candidate.signature.authorityId ?? candidate.signature.signerId;
      const authorityWindowValid =
        authority !== null &&
        Date.parse(candidate.signature.signedAt) >= Date.parse(authority.validFrom) &&
        (typeof authority.validUntil === "undefined" || Date.parse(candidate.signature.signedAt) <= Date.parse(authority.validUntil));
      const authorityValid = authority !== null && authority.authorityId === authorityId && authorityWindowValid;
      const keyRegistered = authorityValid && authority.publicKey.length > 0;

      const signatureValid = verifyReplayArtifactSignature(root, candidate.signature, {
        strictAuthorityVerification: true,
        resolveAuthority: (id) => (authority && id === authority.authorityId ? authority : null),
        isAuthorityValidAt: (_id, signedAt) =>
          authority !== null &&
          Date.parse(signedAt) >= Date.parse(authority.validFrom) &&
          (typeof authority.validUntil === "undefined" || Date.parse(signedAt) <= Date.parse(authority.validUntil)),
        resolvePublicKey: (id) => (authority && id === authority.authorityId ? authority.publicKey : null),
      });

      return {
        authorityId,
        authorityValid,
        keyRegistered,
        signatureValid,
        replayValid: signatureValid && candidate.proof.algorithm === "sha256" && candidate.replayHash === computeReplayHash({
          replayId: candidate.replayId,
          decisionId: candidate.decisionId,
          lineageId: candidate.lineageId,
          governanceVersion: candidate.governanceVersion,
          governanceHash: candidate.governanceHash,
          manifestHash: candidate.manifestHash,
          attestationHash: candidate.attestationHash,
          runtimeVersion: candidate.runtimeVersion,
          runtimeHash: candidate.runtimeHash,
          runtimeStartedAt: candidate.runtimeStartedAt,
          runtimeHost: candidate.runtimeHost,
          runtimeProcessId: candidate.runtimeProcessId,
          runtimeNodeVersion: candidate.runtimeNodeVersion,
          runtimePlatform: candidate.runtimePlatform,
          gitCommit: candidate.gitCommit,
          buildHash: candidate.buildHash,
          buildTimestamp: candidate.buildTimestamp,
          worktreeDirty: candidate.worktreeDirty,
          deploymentVersion: candidate.deploymentVersion,
          deploymentHash: candidate.deploymentHash,
          releaseId: candidate.releaseId,
          environment: candidate.environment,
          status: candidate.status,
          failureReasons: candidate.failureReasons,
          authorityOrder: candidate.authorityOrder,
          timestamp: candidate.timestamp,
          startedAt: candidate.startedAt,
          completedAt: candidate.completedAt,
        }),
        proofValid: candidate.proof.algorithm === "sha256",
        issues: signatureValid ? [] : ["signature verification failed"],
      };
    },
    verifyGovernance: async () => overrides?.governanceValid ?? true,
    verifyBuild: () => overrides?.buildValid ?? true,
    verifyDeployment: () => overrides?.deploymentValid ?? true,
    verifyRuntime: () => overrides?.runtimeValid ?? true,
  });
}

describe("Verification engine", () => {
  it("returns TRUSTED for valid replay", async () => {
    const keys = generateEd25519KeyPair();
    const authority = makeAuthority("ava007-authority-v1", keys.publicKey);
    const report = await verifyWithStubs(
      signRecord(buildReplayInput(), authority.authorityId, keys.privateKey, keys.publicKey),
      authority,
    );

    expect(report.trusted).toBe(true);
  });

  it("returns UNTRUSTED when replay hash is tampered", async () => {
    const keys = generateEd25519KeyPair();
    const authority = makeAuthority("ava007-authority-v1", keys.publicKey);
    const signed = signRecord(buildReplayInput(), authority.authorityId, keys.privateKey, keys.publicKey);
    const tampered = { ...signed, replayHash: `${signed.replayHash}-tampered` };
    const report = await verifyWithStubs(tampered, authority);

    expect(report.trusted).toBe(false);
    expect(report.replayValid).toBe(false);
  });

  it("returns UNTRUSTED for unknown authorityId", async () => {
    const keys = generateEd25519KeyPair();
    const signed = signRecord(buildReplayInput(), "unknown-authority", keys.privateKey, keys.publicKey);
    const report = await verifyWithStubs(signed, null);

    expect(report.trusted).toBe(false);
    expect(report.authorityValid).toBe(false);
  });

  it("returns UNTRUSTED when governance verification fails", async () => {
    const keys = generateEd25519KeyPair();
    const authority = makeAuthority("ava007-authority-v1", keys.publicKey);
    const report = await verifyWithStubs(
      signRecord(buildReplayInput(), authority.authorityId, keys.privateKey, keys.publicKey),
      authority,
      { governanceValid: false },
    );

    expect(report.trusted).toBe(false);
    expect(report.governanceValid).toBe(false);
  });

  it("returns UNTRUSTED when runtime verification fails", async () => {
    const keys = generateEd25519KeyPair();
    const authority = makeAuthority("ava007-authority-v1", keys.publicKey);
    const report = await verifyWithStubs(
      signRecord(buildReplayInput(), authority.authorityId, keys.privateKey, keys.publicKey),
      authority,
      { runtimeValid: false },
    );

    expect(report.trusted).toBe(false);
    expect(report.runtimeValid).toBe(false);
  });

  it("returns TRUSTED for historical artifact within key validity window", async () => {
    const keys = generateEd25519KeyPair();
    const authority = makeAuthority(
      "ava007-authority-v1",
      keys.publicKey,
      "retired",
      "2026-06-03T00:00:00.000Z",
      "2026-07-01T00:00:00.000Z",
    );
    const report = await verifyWithStubs(
      signRecord(
        buildReplayInput(),
        authority.authorityId,
        keys.privateKey,
        keys.publicKey,
        "2026-06-15T00:00:00.000Z",
      ),
      authority,
    );

    expect(report.trusted).toBe(true);
  });

  it("returns UNTRUSTED for artifact after revocation/validity window", async () => {
    const keys = generateEd25519KeyPair();
    const authority = makeAuthority(
      "ava007-authority-v1",
      keys.publicKey,
      "revoked",
      "2026-06-03T00:00:00.000Z",
      "2026-07-01T00:00:00.000Z",
    );
    const report = await verifyWithStubs(
      signRecord(
        buildReplayInput(),
        authority.authorityId,
        keys.privateKey,
        keys.publicKey,
        "2026-07-15T00:00:00.000Z",
      ),
      authority,
    );

    expect(report.trusted).toBe(false);
    expect(report.authorityValid).toBe(false);
  });
});
