import { describe, expect, it } from "vitest";
import { computeRecordHash } from "../../memory/jsonl/hash.js";
import { MemoryRecord } from "../../memory/jsonl/memoryRecord.js";

describe("MemoryRecord hash determinism", () => {
  it("produces identical hash regardless of metadata key order", () => {
    const recordA: MemoryRecord = {
      id: "rec-1",
      type: "event",
      source: "sensor",
      timestamp: "2026-06-03T00:00:00.000Z",
      content: "payload",
      metadata: {
        confidence: 0.9,
        importance: "high",
        previous_hash: "0".repeat(64),
        signature: "ZHVtbXk=",
      },
    };

    const recordB: MemoryRecord = {
      id: "rec-1",
      type: "event",
      source: "sensor",
      timestamp: "2026-06-03T00:00:00.000Z",
      content: "payload",
      metadata: {
        signature: "ZHVtbXk=",
        previous_hash: "0".repeat(64),
        importance: "high",
        confidence: 0.9,
      },
    };

    expect(computeRecordHash(recordA)).toBe(computeRecordHash(recordB));
  });
});
