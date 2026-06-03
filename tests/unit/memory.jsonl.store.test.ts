import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { computeRecordHash, canonicalRecordForSigning } from "../../memory/jsonl/hash.js";
import { append, query } from "../../memory/jsonl/jsonlStore.js";
import { MemoryRecord } from "../../memory/jsonl/memoryRecord.js";
import { verify, verifySignature } from "../../memory/jsonl/signatureVerification.js";

const testDirs: string[] = [];

afterEach(async () => {
  await Promise.all(testDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("memory/jsonl invariant", () => {
  it("appends signed records and queries by filter", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mem-jsonl-"));
    testDirs.push(dir);
    const ledger = join(dir, "memory.jsonl");

    const { privateKey, publicKey } = generateKeyPairSync("ed25519");

    const firstUnsigned: MemoryRecord = {
      id: "rec-1",
      type: "event",
      source: "sensor",
      timestamp: "2026-06-03T00:00:00.000Z",
      content: "boot",
      metadata: {
        confidence: 0.9,
        importance: "high",
      },
    };

    const firstSigned: MemoryRecord = {
      ...firstUnsigned,
      metadata: {
        ...firstUnsigned.metadata,
        signature: sign(null, Buffer.from(canonicalRecordForSigning(firstUnsigned), "utf8"), privateKey).toString("base64"),
      },
    };

    await append(ledger, firstSigned);

    const secondUnsigned: MemoryRecord = {
      id: "rec-2",
      type: "event",
      source: "sensor",
      timestamp: "2026-06-03T00:00:01.000Z",
      content: "heartbeat",
      metadata: {
        confidence: 0.8,
        importance: "medium",
        previous_hash: computeRecordHash(firstSigned),
      },
    };

    const secondSigned: MemoryRecord = {
      ...secondUnsigned,
      metadata: {
        ...secondUnsigned.metadata,
        signature: sign(null, Buffer.from(canonicalRecordForSigning(secondUnsigned), "utf8"), privateKey).toString("base64"),
      },
    };

    await append(ledger, secondSigned);

    const records: MemoryRecord[] = [];
    for await (const record of query(ledger, { type: "event", contentIncludes: "heart" })) {
      records.push(record);
    }

    expect(records).toHaveLength(1);
    expect(records[0].id).toBe("rec-2");
    expect(verify(records[0])).toBe(true);
    expect(verifySignature(records[0], publicKey.export({ format: "pem", type: "spki" }).toString())).toBe(true);

    const raw = await readFile(ledger, "utf8");
    expect(raw.trim().split("\n")).toHaveLength(2);
  });

  it("rejects duplicate ids", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mem-jsonl-"));
    testDirs.push(dir);
    const ledger = join(dir, "memory.jsonl");

    const record: MemoryRecord = {
      id: "dup-1",
      type: "event",
      source: "test",
      timestamp: "2026-06-03T00:00:00.000Z",
      content: "x",
      metadata: {},
    };

    await append(ledger, record);
    await expect(append(ledger, record)).rejects.toThrow("already exists");
  });

  it("rejects previous_hash mismatch", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mem-jsonl-"));
    testDirs.push(dir);
    const ledger = join(dir, "memory.jsonl");

    const first: MemoryRecord = {
      id: "chain-1",
      type: "event",
      source: "test",
      timestamp: "2026-06-03T00:00:00.000Z",
      content: "first",
      metadata: {},
    };

    const second: MemoryRecord = {
      id: "chain-2",
      type: "event",
      source: "test",
      timestamp: "2026-06-03T00:00:01.000Z",
      content: "second",
      metadata: {
        previous_hash: "0000000000000000000000000000000000000000000000000000000000000000",
      },
    };

    await append(ledger, first);
    await expect(append(ledger, second)).rejects.toThrow("previous_hash");
  });
});
