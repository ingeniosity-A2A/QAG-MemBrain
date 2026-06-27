import { createVerify } from "crypto";
import type { MemoryRecord } from "../../jsonl/index.js";

export function verify(record: MemoryRecord): boolean {
  if (!record.metadata?.signature || !record.metadata?.publicKeyPem) {
    // No signature to verify — record is unsigned but valid
    return true;
  }

  const { signature, publicKeyPem, ...rest } = record.metadata;
  const payload = JSON.stringify({
    id: record.id,
    type: record.type,
    content: record.content,
    timestamp: record.timestamp,
    ...rest,
  });

  try {
    const v = createVerify("SHA256");
    v.update(payload);
    return v.verify(publicKeyPem as string, signature as string, "base64");
  } catch {
    return false;
  }
}

export function verifySignature(record: MemoryRecord, publicKeyPem: string): boolean {
  if (!record.metadata?.signature) {
    return true;
  }

  const { signature, ...rest } = record.metadata;
  const payload = JSON.stringify({
    id: record.id,
    type: record.type,
    content: record.content,
    timestamp: record.timestamp,
    ...rest,
  });

  try {
    const v = createVerify("SHA256");
    v.update(payload);
    return v.verify(publicKeyPem, signature as string, "base64");
  } catch {
    return false;
  }
}
