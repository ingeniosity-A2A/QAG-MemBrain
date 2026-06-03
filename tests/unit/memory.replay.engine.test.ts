import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { canonicalRecordForSigning, computeRecordHash } from "../../memory/jsonl/hash.js";
import { append } from "../../memory/jsonl/jsonlStore.js";
import { MemoryRecord } from "../../memory/jsonl/memoryRecord.js";
import {
  reconstructState,
  replayFromGenesis,
  replayToTimestamp,
  verifyLedger,
} from "../../memory/replay/replayEngine.js";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function signedRecord(input: Omit<MemoryRecord, "metadata"> & { metadata?: MemoryRecord["metadata"] }, privateKeyPem: string): MemoryRecord {
  const unsigned: MemoryRecord = {
    ...input,
    metadata: input.metadata ?? {},
  };

  const signature = sign(null, Buffer.from(canonicalRecordForSigning(unsigned), "utf8"), privateKeyPem).toString("base64");
  return {
    ...unsigned,
    metadata: {
      ...unsigned.metadata,
      signature,
    },
  };
}

describe("Replay engine", () => {
  it("verifies ledger and replays deterministically", async () => {
    const dir = await mkdtemp(join(tmpdir(), "replay-engine-"));
    dirs.push(dir);
    const filePath = join(dir, "ledger.jsonl");

    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    const publicKeyPem = publicKey.export({ format: "pem", type: "spki" }).toString();

    const first = signedRecord(
      {
        id: "r1",
        type: "event",
        source: "sensor",
        timestamp: "2026-06-03T00:00:00.000Z",
        content: "boot",
      },
      privateKeyPem,
    );

    await append(filePath, first, { publicKeyPem });

    const second = signedRecord(
      {
        id: "r2",
        type: "event",
        source: "sensor",
        timestamp: "2026-06-03T00:00:01.000Z",
        content: "heartbeat",
        metadata: {
          previous_hash: computeRecordHash(first),
        },
      },
      privateKeyPem,
    );

    await append(filePath, second, { publicKeyPem });

    const verification = await verifyLedger(filePath, { publicKeyPem });
    expect(verification.valid).toBe(true);
    expect(verification.failures).toEqual([]);

    const reducer = (state: string[], record: MemoryRecord) => [...state, `${record.id}:${record.content}`];

    const replayed = await replayFromGenesis(filePath, [] as string[], reducer);
    expect(replayed.state).toEqual(["r1:boot", "r2:heartbeat"]);

    const partial = await replayToTimestamp(filePath, "2026-06-03T00:00:00.500Z", [] as string[], reducer);
    expect(partial.state).toEqual(["r1:boot"]);

    const reconstructed = await reconstructState(filePath, [] as string[], reducer, "2026-06-03T00:00:01.000Z");
    expect(reconstructed).toEqual(["r1:boot", "r2:heartbeat"]);
  });

  it("reports verification failures for malformed ledger chain", async () => {
    const dir = await mkdtemp(join(tmpdir(), "replay-engine-"));
    dirs.push(dir);
    const filePath = join(dir, "ledger.jsonl");

    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    const publicKeyPem = publicKey.export({ format: "pem", type: "spki" }).toString();

    const first = signedRecord(
      {
        id: "r1",
        type: "event",
        source: "sensor",
        timestamp: "2026-06-03T00:00:00.000Z",
        content: "boot",
      },
      privateKeyPem,
    );

    await append(filePath, first, { publicKeyPem });

    const second = signedRecord(
      {
        id: "r2",
        type: "event",
        source: "sensor",
        timestamp: "2026-06-03T00:00:01.000Z",
        content: "heartbeat",
        metadata: {
          previous_hash: "f".repeat(64),
        },
      },
      privateKeyPem,
    );

    const raw = `${JSON.stringify(first)}\n${JSON.stringify(second)}\n`;
    await writeFile(filePath, raw, "utf8");

    const verification = await verifyLedger(filePath, { publicKeyPem });
    expect(verification.valid).toBe(false);
    expect(verification.failures.some((failure) => failure.includes("previous_hash mismatch"))).toBe(true);
  });

  it("fails verification when the same records are inserted in a different order", async () => {
    const dir = await mkdtemp(join(tmpdir(), "replay-engine-"));
    dirs.push(dir);
    const ledgerA = join(dir, "ledger-a.jsonl");
    const ledgerB = join(dir, "ledger-b.jsonl");

    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    const publicKeyPem = publicKey.export({ format: "pem", type: "spki" }).toString();

    const record1 = signedRecord(
      {
        id: "r1",
        type: "event",
        source: "sensor",
        timestamp: "2026-06-03T00:00:00.000Z",
        content: "one",
      },
      privateKeyPem,
    );

    const record2 = signedRecord(
      {
        id: "r2",
        type: "event",
        source: "sensor",
        timestamp: "2026-06-03T00:00:01.000Z",
        content: "two",
        metadata: {
          previous_hash: computeRecordHash(record1),
        },
      },
      privateKeyPem,
    );

    const record3 = signedRecord(
      {
        id: "r3",
        type: "event",
        source: "sensor",
        timestamp: "2026-06-03T00:00:02.000Z",
        content: "three",
        metadata: {
          previous_hash: computeRecordHash(record2),
        },
      },
      privateKeyPem,
    );

    await writeFile(ledgerA, `${JSON.stringify(record1)}\n${JSON.stringify(record2)}\n${JSON.stringify(record3)}\n`, "utf8");
    await writeFile(ledgerB, `${JSON.stringify(record2)}\n${JSON.stringify(record1)}\n${JSON.stringify(record3)}\n`, "utf8");

    const verifiedA = await verifyLedger(ledgerA, { publicKeyPem });
    const verifiedB = await verifyLedger(ledgerB, { publicKeyPem });

    expect(verifiedA.valid).toBe(true);
    expect(verifiedB.valid).toBe(false);
    expect(verifiedB.failures.some((failure) => failure.includes("previous_hash mismatch"))).toBe(true);
  });
});
