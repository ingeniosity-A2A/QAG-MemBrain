import { createPublicKey, verify as verifySignatureWithKey } from "node:crypto";
import { canonicalRecordForSigning } from "./hash.js";
import { MemoryRecord, assertMemoryRecord } from "./memoryRecord.js";

const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;

export function verify(record: MemoryRecord): boolean {
  try {
    assertMemoryRecord(record);

    if (typeof record.metadata.signature !== "undefined") {
      if (!BASE64_PATTERN.test(record.metadata.signature)) {
        return false;
      }
    }

    if (typeof record.metadata.previous_hash !== "undefined") {
      if (!SHA256_HEX_PATTERN.test(record.metadata.previous_hash)) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

export function verifySignature(record: MemoryRecord, publicKeyPem: string): boolean {
  if (!verify(record)) {
    return false;
  }

  if (!record.metadata.signature) {
    return false;
  }

  const signature = Buffer.from(record.metadata.signature, "base64");
  const payload = Buffer.from(canonicalRecordForSigning(record), "utf8");

  try {
    const publicKey = createPublicKey(publicKeyPem);
    const algorithm = publicKey.asymmetricKeyType === "ed25519" ? null : "sha256";
    return verifySignatureWithKey(algorithm, payload, publicKey, signature);
  } catch {
    return false;
  }
}
