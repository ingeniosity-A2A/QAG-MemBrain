import { assertReplayRecordShape } from "../persistence/replaySchemas.js";
import { computeReplayHash } from "../persistence/replayHash.js";
import { ReplayRecord, ReplayRecordInput } from "../service/replayRecord.js";
import { buildCanonicalReplayArtifactRoot } from "../signing/signer.js";
import { verifyReplayArtifactSignature } from "../signing/verifier.js";
import { loadAuthoritySignerRegistry } from "../signing/signerRegistry.js";

export interface ReplayVerificationResult {
  authorityId: string;
  authorityValid: boolean;
  keyRegistered: boolean;
  signatureValid: boolean;
  replayValid: boolean;
  proofValid: boolean;
  issues: string[];
}

export function verifyReplay(record: ReplayRecord): ReplayVerificationResult {
  const issues: string[] = [];

  try {
    assertReplayRecordShape(record);
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
    return {
      authorityId: resolveAuthorityId(record),
      authorityValid: false,
      keyRegistered: false,
      signatureValid: false,
      replayValid: false,
      proofValid: false,
      issues,
    };
  }

  const authorityId = resolveAuthorityId(record);
  const registry = loadAuthoritySignerRegistry();
  const authority = registry.resolveAuthority(authorityId);
  const authorityValid = authority !== null && registry.isAuthorityValidAt(authorityId, record.signature.signedAt);
  if (!authorityValid) {
    issues.push(`authority '${authorityId}' is not valid for signature timestamp`);
  }

  const keyRegistered = registry.resolvePublicKey(authorityId) !== null;
  if (!keyRegistered) {
    issues.push(`authority '${authorityId}' has no registered key`);
  }

  const { replayHash, proof, signature, ...payload } = record;
  const expectedReplayHash = computeReplayHash(payload as ReplayRecordInput);
  const replayHashValid = expectedReplayHash === replayHash;
  if (!replayHashValid) {
    issues.push("replay hash mismatch");
  }

  const proofValid = proof.algorithm === "sha256";
  if (!proofValid) {
    issues.push("invalid replay proof algorithm");
  }

  const replayArtifactRoot = buildCanonicalReplayArtifactRoot({
    replayHash,
    runtimeHash: payload.runtimeHash,
    deploymentHash: payload.deploymentHash,
    buildHash: payload.buildHash,
    governanceHash: payload.governanceHash,
    manifestHash: payload.manifestHash,
    attestationHash: payload.attestationHash,
    decisionId: payload.decisionId,
    lineageId: payload.lineageId,
    timestamp: payload.timestamp,
  });

  const signatureValid = verifyReplayArtifactSignature(replayArtifactRoot, signature, {
    strictAuthorityVerification: true,
  });
  if (!signatureValid) {
    issues.push("signature verification failed");
  }

  return {
    authorityId,
    authorityValid,
    keyRegistered,
    signatureValid,
    replayValid: replayHashValid && proofValid && signatureValid,
    proofValid,
    issues,
  };
}

function resolveAuthorityId(record: ReplayRecord): string {
  const signature = (record as Partial<ReplayRecord>).signature as
    | { authorityId?: string; signerId?: string }
    | undefined;

  if (typeof signature?.authorityId === "string" && signature.authorityId.length > 0) {
    return signature.authorityId;
  }

  if (typeof signature?.signerId === "string" && signature.signerId.length > 0) {
    return signature.signerId;
  }

  return "unknown-authority";
}
