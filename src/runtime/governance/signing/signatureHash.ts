import { createHash } from "node:crypto";
import { ReplayArtifactRoot } from "./signatureRecord.js";

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

export function computeReplayArtifactHash(payload: ReplayArtifactRoot): string {
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}
