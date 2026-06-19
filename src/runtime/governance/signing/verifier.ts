import { createPublicKey, verify as verifyBuffer } from "node:crypto";
import { SignatureRecord, ReplayArtifactRoot } from "./signatureRecord.js";
import { computeReplayArtifactHash } from "./signatureHash.js";
import { AuthorityKeyDescriptor } from "./keyStore.js";
import { loadAuthoritySignerRegistry } from "./signerRegistry.js";

export interface ReplaySignatureVerificationOptions {
  strictAuthorityVerification?: boolean;
  resolveAuthority?: (authorityId: string) => AuthorityKeyDescriptor | null;
  isAuthorityValidAt?: (authorityId: string, signedAt: string) => boolean;
  resolvePublicKey?: (authorityId: string) => string | null;
}

function isStrictAuthorityVerificationEnabled(override?: boolean): boolean {
  if (typeof override === "boolean") {
    return override;
  }

  return process.env.AVA007_STRICT_AUTHORITY_VERIFICATION === "true";
}

export function verifyReplayArtifactSignature(
  payload: ReplayArtifactRoot,
  signatureRecord: SignatureRecord,
  options?: ReplaySignatureVerificationOptions,
): boolean {
  if (signatureRecord.algorithm !== "ed25519") {
    return false;
  }

  const expectedHash = computeReplayArtifactHash(payload);
  if (signatureRecord.artifactHash !== expectedHash) {
    return false;
  }

  try {
    const strict = isStrictAuthorityVerificationEnabled(options?.strictAuthorityVerification);
    const registry = loadAuthoritySignerRegistry();
    const resolveAuthority =
      options?.resolveAuthority ?? ((authorityId: string) => registry.resolveAuthority(authorityId));
    const isAuthorityValidAt =
      options?.isAuthorityValidAt ?? ((authorityId: string, signedAt: string) => registry.isAuthorityValidAt(authorityId, signedAt));
    const resolver = options?.resolvePublicKey ?? ((authorityId: string) => registry.resolvePublicKey(authorityId));
    const explicitAuthorityId =
      typeof signatureRecord.authorityId === "string" && signatureRecord.authorityId.length > 0
        ? signatureRecord.authorityId
        : null;

    const authorityId = explicitAuthorityId ?? signatureRecord.signerId;
    if (explicitAuthorityId && resolveAuthority(explicitAuthorityId) === null) {
      return false;
    }

    const knownAuthority = resolveAuthority(authorityId);
    if (knownAuthority && !isAuthorityValidAt(authorityId, signatureRecord.signedAt)) {
      return false;
    }

    const resolvedPublicKey = resolver(authorityId);
    const allowLegacyEmbeddedKey = !strict && (explicitAuthorityId === null || (knownAuthority !== null && !resolvedPublicKey));
    const publicKeyPem = resolvedPublicKey ?? (allowLegacyEmbeddedKey ? signatureRecord.publicKey : undefined);
    if (!publicKeyPem || publicKeyPem.length === 0) {
      return false;
    }

    const publicKey = createPublicKey(publicKeyPem);
    return verifyBuffer(
      null,
      Buffer.from(signatureRecord.artifactHash, "utf8"),
      publicKey,
      Buffer.from(signatureRecord.signature, "base64"),
    );
  } catch {
    return false;
  }
}
