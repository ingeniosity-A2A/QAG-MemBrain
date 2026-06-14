export interface MemoryAtom {
  id: string;
  timestamp: string;
  actor: string;
  type: string;
  payload: unknown;
  metadata: Record<string, unknown>;
}

export function isMemoryAtom(value: unknown): value is MemoryAtom {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<MemoryAtom>;
  const hasRequiredStrings =
    typeof candidate.id === "string" &&
    typeof candidate.timestamp === "string" &&
    typeof candidate.actor === "string" &&
    typeof candidate.type === "string";

  const metadataIsRecord =
    typeof candidate.metadata === "object" &&
    candidate.metadata !== null &&
    !Array.isArray(candidate.metadata);

  return hasRequiredStrings && metadataIsRecord;
}

export function assertMemoryAtom(value: unknown): asserts value is MemoryAtom {
  if (!isMemoryAtom(value)) {
    throw new Error("Invalid MemoryAtom schema");
  }

  const parsedDate = Date.parse(value.timestamp);
  if (Number.isNaN(parsedDate)) {
    throw new Error("MemoryAtom.timestamp must be a valid ISO date string");
  }
}