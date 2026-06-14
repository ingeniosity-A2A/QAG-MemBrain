import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { append } from "../../memory/jsonl/jsonlStore.js";
import { MemoryRecord } from "../../memory/jsonl/memoryRecord.js";
import { computeRecordHash } from "../../memory/jsonl/hash.js";
import { replayFromGenesis, verifyLedger } from "../../memory/replay/replayEngine.js";
import { InMemoryDIDRegistry } from "../../trust/did/didRegistry.js";
import { buildMerkleRoot, generateProof, verifyProof } from "../../trust/merkle/merkleProof.js";
import { InMemoryTashiNode } from "../../trust/tashi/gossip.js";
import { Vertex, computeVertexHash, validateVertex } from "../../trust/tashi/vertex.js";
import { signPayload, signRecord, verifyRecord } from "../../trust/verification/signerService.js";

const cleanupTargets: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupTargets.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("EPIC-003A trust to replay verification", () => {
  it("proves signed memory can be merkle-verified, vertex-gossiped, and replayed into identical state", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qag-membrain-epic-003a-"));
    cleanupTargets.push(dir);
    const ledgerPath = join(dir, "ledger.jsonl");

    const keyPair = generateKeyPairSync("ed25519");
    const privateKeyPem = keyPair.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    const publicKeyPem = keyPair.publicKey.export({ format: "pem", type: "spki" }).toString();

    const didRegistry = new InMemoryDIDRegistry();
    const did = didRegistry.createDID({
      id: "did:ava:epic-003a",
      algorithm: "ed25519",
      publicKeyPem,
      timestamp: "2026-06-03T00:00:00.000Z",
    });

    const unsignedRecords: MemoryRecord[] = [
      {
        id: "m-1",
        type: "event",
        source: "sensor:s25",
        timestamp: "2026-06-03T00:00:00.000Z",
        content: "boot",
        metadata: {
          confidence: 1,
          importance: "high",
        },
      },
      {
        id: "m-2",
        type: "event",
        source: "sensor:s26",
        timestamp: "2026-06-03T00:00:01.000Z",
        content: "link-established",
        metadata: {
          confidence: 0.95,
          importance: "high",
        },
      },
      {
        id: "m-3",
        type: "event",
        source: "a2a",
        timestamp: "2026-06-03T00:00:02.000Z",
        content: "replay-ready",
        metadata: {
          confidence: 0.9,
          importance: "medium",
        },
      },
    ];

    const signedRecords: MemoryRecord[] = [];
    for (const unsigned of unsignedRecords) {
      const previous = signedRecords.at(-1);
      const withChain: MemoryRecord = {
        ...unsigned,
        metadata: {
          ...unsigned.metadata,
          previous_hash: previous ? computeRecordHash(previous) : undefined,
        },
      };

      const signed = signRecord(withChain, privateKeyPem);
      signedRecords.push(signed);

      await append(ledgerPath, signed, {
        signatureVerifier: (record) => {
          const activeKey = didRegistry.activeKeys(did.id)[0];
          return Boolean(activeKey) && verifyRecord(record, activeKey.publicKeyPem);
        },
      });
    }

    const verification = await verifyLedger(ledgerPath, {
      signatureVerifier: (record) => {
        const activeKey = didRegistry.activeKeys(did.id)[0];
        return Boolean(activeKey) && verifyRecord(record, activeKey.publicKeyPem);
      },
    });

    expect(verification.valid).toBe(true);
    expect(verification.failures).toEqual([]);

    const recordHashes = signedRecords.map((record) => computeRecordHash(record));
    const root = buildMerkleRoot(recordHashes);
    expect(root.length).toBe(64);

    for (let index = 0; index < recordHashes.length; index += 1) {
      const proof = generateProof(recordHashes, index);
      expect(proof.rootHash).toBe(root);
      expect(verifyProof(recordHashes[index], proof)).toBe(true);
    }

    const nodeA = new InMemoryTashiNode("A");
    const nodeB = new InMemoryTashiNode("B");
    const nodeC = new InMemoryTashiNode("C");
    nodeA.connect(nodeB);
    nodeB.connect(nodeC);

    const knownParents = new Set<string>();
    let previousVertexHash: string | null = null;
    for (let index = 0; index < signedRecords.length; index += 1) {
      const record = signedRecords[index];
      const parentHashes = previousVertexHash ? [previousVertexHash] : [];

      const derivedHash = computeVertexHash({
        parentHashes,
        creatorDid: did.id,
        timestamp: Date.parse(record.timestamp),
        payload: {
          recordId: record.id,
          recordHash: computeRecordHash(record),
          merkleRoot: root,
        },
      });

      const signedPayload = {
        hash: derivedHash,
        parentHashes,
        creatorDid: did.id,
        timestamp: Date.parse(record.timestamp),
        payload: {
          recordId: record.id,
          recordHash: computeRecordHash(record),
          merkleRoot: root,
        },
      };

      const vertex: Vertex = {
        hash: derivedHash,
        parentHashes,
        creatorDid: did.id,
        timestamp: Date.parse(record.timestamp),
        payload: signedPayload.payload,
        signature: signPayload(signedPayload, privateKeyPem),
      };

      const validation = validateVertex(vertex, {
        knownVertexHashes: knownParents,
        publicKeyResolver: (requestedDid) => {
          const doc = didRegistry.resolveDID(requestedDid);
          return doc ? didRegistry.activeKeys(doc.id)[0]?.publicKeyPem ?? null : null;
        },
      });

      expect(validation.valid).toBe(true);

      nodeA.publish(vertex);
      previousVertexHash = vertex.hash;
      knownParents.add(vertex.hash);
    }

    expect(nodeA.vertexCount()).toBe(3);
    expect(nodeB.vertexCount()).toBe(3);
    expect(nodeC.vertexCount()).toBe(3);

    const expectedState = signedRecords.map((record) => `${record.id}:${record.content}`);
    const replayed = await replayFromGenesis(ledgerPath, [] as string[], (state, record) => [
      ...state,
      `${record.id}:${record.content}`,
    ]);

    expect(replayed.state).toEqual(expectedState);
  });
});
