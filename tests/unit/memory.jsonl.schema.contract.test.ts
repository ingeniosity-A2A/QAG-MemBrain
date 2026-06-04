import Ajv from "ajv";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import schema from "../../memory/jsonl/schema.json";

describe("memory jsonl schema contract", () => {
  it("accepts a valid memory record per schema.json", () => {
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(schema);

    const validRecord = {
      id: "mem-001",
      type: "event",
      source: "nfc_handshake",
      timestamp: "2026-06-04T00:00:00.000Z",
      content: "Tap from asset tag 0x7F3A",
      metadata: {
        confidence: 1,
        importance: "high",
        signature: "ZmFrZVNpZ25hdHVyZQ==",
      },
    };

    expect(validate(validRecord)).toBe(true);
  });

  it("rejects invalid previous_hash format", () => {
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(schema);

    const invalidRecord = {
      id: "mem-002",
      type: "event",
      source: "nfc_handshake",
      timestamp: "2026-06-04T00:00:00.000Z",
      content: "Broken chain",
      metadata: {
        previous_hash: "not-a-64-char-hex",
      },
    };

    expect(validate(invalidRecord)).toBe(false);
  });
});
