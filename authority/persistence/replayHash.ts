import { createHash } from "node:crypto";
import { ReplayRecordInput } from "../service/replayRecord.js";

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  return `{${entries
    .map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`)
    .join(",")}}`;
}

export function computeReplayHash(record: ReplayRecordInput): string {
  return createHash("sha256").update(stableStringify(record)).digest("hex");
}