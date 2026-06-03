import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { append } from "../../memory/jsonl/jsonlStore.js";
import { MemoryRecord } from "../../memory/jsonl/memoryRecord.js";
import { computeRecordHash } from "../../memory/jsonl/hash.js";
import { signRecord, verifyRecord } from "../../trust/verification/signerService.js";
import { InMemoryDIDRegistry } from "../../trust/did/didRegistry.js";
import { InMemoryCognitiveGraphRepository } from "../../graph/neo4j/repositories/cognitiveGraphRepository.js";
import { proposeInterpretationMemory } from "../../interpretation/lens.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("EPIC-006 interpretation memory proposal", () => {
  it("produces an observation proposal without writing to the ledger", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qag-interpretation-proposal-"));
    cleanup.push(dir);
    const ledgerPath = join(dir, "ledger.jsonl");

    const pair = generateKeyPairSync("ed25519");
    const privateKeyPem = pair.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    const publicKeyPem = pair.publicKey.export({ format: "pem", type: "spki" }).toString();

    const didRegistry = new InMemoryDIDRegistry();
    const did = didRegistry.createDID({ id: "did:ava:interpretation-proposal", algorithm: "ed25519", publicKeyPem });

    const records: MemoryRecord[] = [
      {
        id: "p-1",
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
        id: "p-2",
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

    const before = await readFile(ledgerPath, "utf8");
    const proposal = await proposeInterpretationMemory(ledgerPath, {
      repositoryFactory: () => new InMemoryCognitiveGraphRepository(),
    });
    const after = await readFile(ledgerPath, "utf8");

    expect(before).toBe(after);
    expect(proposal.type).toBe("observation");
    expect(proposal.source).toBe("rev_ike_lens");
    expect(proposal.derived_from.length).toBeGreaterThan(0);
    expect(proposal.insight).toContain("Replay reconstructs");
    expect(proposal.confidence).toBeGreaterThan(0);
    expect(proposal.observationCount).toBeGreaterThan(0);
    expect(proposal.graphHash.length).toBe(64);
  });
});
