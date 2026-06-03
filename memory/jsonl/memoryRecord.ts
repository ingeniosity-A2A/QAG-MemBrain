export interface MemoryRecord {
  id: string;
  type: string;
  source: string;
  timestamp: string;
  content: string;
  metadata: {
    confidence?: number;
    importance?: string;
    signature?: string;
    previous_hash?: string;
  };
}

export interface MemoryQueryFilter {
  id?: string;
  type?: string;
  source?: string;
  fromTimestamp?: string;
  toTimestamp?: string;
  contentIncludes?: string;
}

export function isMemoryRecord(value: unknown): value is MemoryRecord {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<MemoryRecord>;
  const metadata = candidate.metadata as MemoryRecord["metadata"] | undefined;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.type === "string" &&
    typeof candidate.source === "string" &&
    typeof candidate.timestamp === "string" &&
    typeof candidate.content === "string" &&
    typeof metadata === "object" &&
    metadata !== null &&
    !Array.isArray(metadata)
  );
}

export function assertMemoryRecord(value: unknown): asserts value is MemoryRecord {
  if (!isMemoryRecord(value)) {
    throw new Error("Invalid MemoryRecord schema");
  }

  if (Number.isNaN(Date.parse(value.timestamp))) {
    throw new Error("MemoryRecord.timestamp must be a valid ISO timestamp");
  }

  if (typeof value.metadata.confidence !== "undefined") {
    if (typeof value.metadata.confidence !== "number" || Number.isNaN(value.metadata.confidence)) {
      throw new Error("MemoryRecord.metadata.confidence must be a number when provided");
    }
  }

  if (typeof value.metadata.importance !== "undefined" && typeof value.metadata.importance !== "string") {
    throw new Error("MemoryRecord.metadata.importance must be a string when provided");
  }

  if (typeof value.metadata.signature !== "undefined" && typeof value.metadata.signature !== "string") {
    throw new Error("MemoryRecord.metadata.signature must be a string when provided");
  }

  if (typeof value.metadata.previous_hash !== "undefined" && typeof value.metadata.previous_hash !== "string") {
    throw new Error("MemoryRecord.metadata.previous_hash must be a string when provided");
  }
}
