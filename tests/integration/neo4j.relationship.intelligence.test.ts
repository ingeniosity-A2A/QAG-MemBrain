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
import { projectJsonlLedgerToGraph } from "../../graph/reconstruction/jsonlGraphProjection.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("EPIC-004 Neo4j relationship intelligence", () => {
  it("projects JSONL records into deterministic graph nodes and relationships", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qag-neo4j-projection-"));
    cleanup.push(dir);
    const ledgerPath = join(dir, "ledger.jsonl");

    const pair = generateKeyPairSync("ed25519");
    const privateKeyPem = pair.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    const publicKeyPem = pair.publicKey.export({ format: "pem", type: "spki" }).toString();

    const didRegistry = new InMemoryDIDRegistry();
    const did = didRegistry.createDID({ id: "did:ava:graph-test", algorithm: "ed25519", publicKeyPem });

    const unsigned1: MemoryRecord = {
      id: "m-g-1",
      type: "event",
      source: "sensor:s25",
      timestamp: "2026-06-03T00:00:00.000Z",
      content: "entity:quote-812 policy:approval-policy-v4",
      metadata: {
        confidence: 0.95,
        importance: "high",
      },
    };

    const signed1 = signRecord(unsigned1, privateKeyPem);
    await append(ledgerPath, signed1, {
      signatureVerifier: (record) => verifyRecord(record, didRegistry.activeKeys(did.id)[0].publicKeyPem),
    });

    const unsigned2: MemoryRecord = {
      id: "m-g-2",
      type: "event",
      source: "sensor:s25",
      timestamp: "2026-06-03T00:00:01.000Z",
      content: "entity:quote-812 session:assembly-shift-a",
      metadata: {
        confidence: 0.9,
        importance: "medium",
        previous_hash: computeRecordHash(signed1),
      },
    };

    const signed2 = signRecord(unsigned2, privateKeyPem);
    await append(ledgerPath, signed2, {
      signatureVerifier: (record) => verifyRecord(record, didRegistry.activeKeys(did.id)[0].publicKeyPem),
    });

    const graph = new InMemoryCognitiveGraphRepository();
    const summary = await projectJsonlLedgerToGraph(ledgerPath, graph);

    expect(summary.memoryCount).toBe(2);
    expect(summary.nodeCount).toBeGreaterThanOrEqual(5);
    expect(summary.relationshipCount).toBeGreaterThanOrEqual(5);

    const memory1 = await graph.getNode("m-g-1");
    const memory2 = await graph.getNode("m-g-2");
    const quoteEntity = await graph.getNode("entity:quote-812");
    const policyNode = await graph.getNode("policy:approval-policy-v4");

    expect(memory1?.type).toBe("Memory");
    expect(memory2?.type).toBe("Memory");
    expect(quoteEntity?.type).toBe("Document");
    expect(policyNode?.type).toBe("Policy");

    const context1 = await graph.getContext("m-g-1");
    const relationshipTypes = context1.outgoing.map((rel) => rel.type);
    expect(relationshipTypes).toContain("REFERENCES");
    expect(relationshipTypes).toContain("INFLUENCED_BY");

    const context2 = await graph.getContext("m-g-2");
    const relatedIds2 = context2.relatedNodeIds;
    expect(relatedIds2).toContain("entity:quote-812");

    const memoryLinkContext = await graph.getContext("m-g-1", "RELATED_TO");
    expect(memoryLinkContext.relatedNodeIds).toContain("m-g-2");
  });
});
