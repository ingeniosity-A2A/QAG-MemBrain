import { createPrivateKey, createPublicKey, sign as signWithKey, verify as verifyWithKey } from "node:crypto";
import { stableStringify } from "../../memory/jsonl/hash.js";
import { MemoryRecord } from "../../memory/jsonl/memoryRecord.js";
import { canonicalRecordForSigning } from "../../memory/jsonl/hash.js";

export function signPayload(payload: unknown, privateKeyPem: string): string {
  const bytes = Buffer.from(stableStringify(payload), "utf8");
  const privateKey = createPrivateKey(privateKeyPem);
  const algorithm = privateKey.asymmetricKeyType === "ed25519" ? null : "sha256";
  return signWithKey(algorithm, bytes, privateKey).toString("base64");
}

export function verifyPayload(payload: unknown, signatureBase64: string, publicKeyPem: string): boolean {
  try {
    const bytes = Buffer.from(stableStringify(payload), "utf8");
    const signature = Buffer.from(signatureBase64, "base64");
    const publicKey = createPublicKey(publicKeyPem);
    const algorithm = publicKey.asymmetricKeyType === "ed25519" ? null : "sha256";
    return verifyWithKey(algorithm, bytes, publicKey, signature);
  } catch {
    return false;
  }
}

export function signRecord(record: MemoryRecord, privateKeyPem: string): MemoryRecord {
  const signature = signCanonical(canonicalRecordForSigning(record), privateKeyPem);
  return {
    ...record,
    metadata: {
      ...record.metadata,
      signature,
    },
  };
}

export function verifyRecord(record: MemoryRecord, publicKeyPem: string): boolean {
  if (!record.metadata.signature) {
    return false;
  }

  return verifyCanonical(canonicalRecordForSigning(record), record.metadata.signature, publicKeyPem);
}

function signCanonical(canonical: string, privateKeyPem: string): string {
  const bytes = Buffer.from(canonical, "utf8");
  const privateKey = createPrivateKey(privateKeyPem);
  const algorithm = privateKey.asymmetricKeyType === "ed25519" ? null : "sha256";
  return signWithKey(algorithm, bytes, privateKey).toString("base64");
}

function verifyCanonical(canonical: string, signatureBase64: string, publicKeyPem: string): boolean {
  try {
    const bytes = Buffer.from(canonical, "utf8");
    const signature = Buffer.from(signatureBase64, "base64");
    const publicKey = createPublicKey(publicKeyPem);
    const algorithm = publicKey.asymmetricKeyType === "ed25519" ? null : "sha256";
    return verifyWithKey(algorithm, bytes, publicKey, signature);
  } catch {
    return false;
  }
}
