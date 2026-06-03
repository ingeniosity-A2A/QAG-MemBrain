import { createHash } from "node:crypto";
import { MemoryRecord } from "./memoryRecord.js";

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`).join(",")}}`;
}

export function canonicalRecordForSigning(record: MemoryRecord): string {
  return stableStringify({
    ...record,
    metadata: {
      ...record.metadata,
      signature: undefined,
    },
  });
}

export function computeRecordHash(record: MemoryRecord): string {
  return createHash("sha256").update(canonicalRecordForSigning(record)).digest("hex");
}
