import { MemoryRecord } from "../memory/jsonl/index.js";

export interface ExtractedEntity {
  id: string;
  type: "Document" | "Policy" | "Session";
  confidence: number;
}

const ENTITY_TOKEN = /\b(?:entity|quote|policy|session):([a-z0-9._:-]+)\b/gi;

export function extractEntities(record: MemoryRecord): ExtractedEntity[] {
  const entities: ExtractedEntity[] = [];
  const seen = new Set<string>();

  for (const match of record.content.matchAll(ENTITY_TOKEN)) {
    const raw = (match[1] ?? "").toLowerCase();
    if (!raw || seen.has(raw)) {
      continue;
    }

    seen.add(raw);
    entities.push({
      id: classifyEntityId(raw),
      type: classifyEntityType(raw),
      confidence: typeof record.metadata?.confidence === "number" ? record.metadata.confidence : 0.7,
    });
  }

  return entities;
}

function classifyEntityType(rawId: string): "Document" | "Policy" | "Session" {
  if (rawId.includes("policy")) {
    return "Policy";
  }

  if (rawId.includes("session")) {
    return "Session";
  }

  return "Document";
}

function classifyEntityId(rawId: string): string {
  if (rawId.startsWith("policy:") || rawId.startsWith("session:") || rawId.startsWith("entity:") || rawId.startsWith("quote:")) {
    return rawId;
  }

  if (rawId.includes("policy")) {
    return `policy:${rawId}`;
  }

  if (rawId.includes("session")) {
    return `session:${rawId}`;
  }

  return `entity:${rawId}`;
}
