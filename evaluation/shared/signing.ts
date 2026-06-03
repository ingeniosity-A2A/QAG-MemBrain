import { createHash, createPrivateKey, createPublicKey, sign as signBuffer, verify as verifyBuffer } from "node:crypto";
import { getDefaultReplaySigner } from "../../authority/signing/signer.js";
import { loadAuthoritySignerRegistry } from "../../authority/signing/signerRegistry.js";

export interface EvaluationSignature {
  algorithm: "ed25519";
  authorityId: string;
  signerId: string;
  signedAt: string;
  hash: string;
  signature: string;
  publicKey?: string;
}

export function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function signEvaluationHash(hash: string): EvaluationSignature {
  const signer = getDefaultReplaySigner();
  const privateKey = createPrivateKey(signer.privateKey);
  const signature = signBuffer(null, Buffer.from(hash, "utf8"), privateKey).toString("base64");

  return {
    algorithm: "ed25519",
    authorityId: signer.authorityId,
    signerId: signer.signerId,
    signedAt: new Date().toISOString(),
    hash,
    signature,
    publicKey: signer.publicKey,
  };
}

export function verifyEvaluationSignature(payload: EvaluationSignature): boolean {
  if (payload.algorithm !== "ed25519") {
    return false;
  }

  try {
    const strict = process.env.AVA007_STRICT_AUTHORITY_VERIFICATION === "true";
    const registry = loadAuthoritySignerRegistry();
    const authority = registry.resolveAuthority(payload.authorityId);
    if (authority === null) {
      return false;
    }

    if (!registry.isAuthorityValidAt(payload.authorityId, payload.signedAt)) {
      return false;
    }

    const resolvedKey = registry.resolvePublicKey(payload.authorityId);
    const publicKeyPem = resolvedKey ?? (!strict ? payload.publicKey : undefined);
    if (!publicKeyPem || publicKeyPem.length === 0) {
      return false;
    }

    const publicKey = createPublicKey(publicKeyPem);
    return verifyBuffer(
      null,
      Buffer.from(payload.hash, "utf8"),
      publicKey,
      Buffer.from(payload.signature, "base64"),
    );
  } catch {
    return false;
  }
}
