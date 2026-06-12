import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { append } from "../../memory/jsonl/jsonlStore.js";
import { MemoryRecord } from "../../memory/jsonl/memoryRecord.js";
import { computeRecordHash } from "../../memory/jsonl/hash.js";
import { signRecord, verifyRecord } from "../../trust/verification/signerService.js";
import { InMemoryDIDRegistry } from "../../trust/did/didRegistry.js";
import { InMemoryCognitiveGraphRepository } from "../../graph/neo4j/repositories/cognitiveGraphRepository.js";
import { projectJsonlLedgerToGraphHash } from "../../graph/reconstruction/jsonlGraphProjection.js";
import { verifyGraphRebuild } from "../../graph/reconstruction/graphRebuild.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("EPIC-004A graph rebuild verification", () => {
  it("rebuilds the same graph from the same ledger and produces equal hashes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qag-graph-rebuild-"));
    cleanup.push(dir);
    const ledgerPath = join(dir, "ledger.jsonl");

    const pair = generateKeyPairSync("ed25519");
    const privateKeyPem = pair.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    const publicKeyPem = pair.publicKey.export({ format: "pem", type: "spki" }).toString();

    const didRegistry = new InMemoryDIDRegistry();
    const did = didRegistry.createDID({ id: "did:ava:rebuild-test", algorithm: "ed25519", publicKeyPem });

    const records: MemoryRecord[] = [
      {
        id: "g-1",
        type: "event",
        source: "sensor:s25",
        timestamp: "2026-06-03T00:00:00.000Z",
        content: "entity:quote-812 policy:approval-policy-v4",
        metadata: {
          confidence: 0.95,
          importance: "high",
        },
      },
      {
        id: "g-2",
        type: "event",
        source: "sensor:s26",
        timestamp: "2026-06-03T00:00:01.000Z",
        content: "entity:quote-812 session:assembly-shift-a",
        metadata: {
          confidence: 0.9,
          importance: "medium",
          previous_hash: undefined,
        },
      },
      {
        id: "g-3",
        type: "event",
        source: "a2a",
        timestamp: "2026-06-03T00:00:02.000Z",
        content: "entity:quote-812 policy:approval-policy-v4",
        metadata: {
          confidence: 0.85,
          importance: "medium",
          previous_hash: undefined,
        },
      },
    ];

    const signedRecords: MemoryRecord[] = [];
    for (const record of records) {
      const previous = signedRecords.at(-1);
      const prepared: MemoryRecord = {
        ...record,
        metadata: {
          ...record.metadata,
          previous_hash: previous ? computeRecordHash(previous) : undefined,
        },
      };

      const signed = signRecord(prepared, privateKeyPem);
      signedRecords.push(signed);
      await append(ledgerPath, signed, {
        signatureVerifier: (candidate) => verifyRecord(candidate, didRegistry.activeKeys(did.id)[0].publicKeyPem),
      });
    }

    const verification = await verifyGraphRebuild(ledgerPath);
    expect(verification.valid).toBe(true);
    expect(verification.leftHash).toBe(verification.rightHash);
    expect(verification.firstSummary.nodeCount).toBe(verification.secondSummary.nodeCount);
    expect(verification.firstSummary.relationshipCount).toBe(verification.secondSummary.relationshipCount);
    expect(verification.firstSummary.memoryCount).toBe(verification.secondSummary.memoryCount);

    const firstRepo = new InMemoryCognitiveGraphRepository();
    const first = await projectJsonlLedgerToGraphHash(ledgerPath, firstRepo);

    const secondRepo = new InMemoryCognitiveGraphRepository();
    const second = await projectJsonlLedgerToGraphHash(ledgerPath, secondRepo);

    expect(first.graphHash).toBe(second.graphHash);
    expect(first.snapshot.nodes).toEqual(second.snapshot.nodes);
    expect(first.snapshot.relationships).toEqual(second.snapshot.relationships);
  });
});
