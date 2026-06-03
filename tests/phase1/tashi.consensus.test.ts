import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HashChainTashiConsensus } from "../../consensus/tashi/consensus.js";
import { appendAtom } from "../../memory/ledger/jsonlLedger.js";

const cleanupTargets: string[] = [];

afterEach(async () => {
  while (cleanupTargets.length > 0) {
    const path = cleanupTargets.pop();
    if (path) {
      await rm(path, { recursive: true, force: true });
    }
  }
});

describe("Tashi hash-chain consensus", () => {
  it("creates vertices and verifies lineage through parent hashes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qag-membrain-tashi-"));
    cleanupTargets.push(dir);
    const ledgerPath = join(dir, "atoms.jsonl");

    const atomA = await appendAtom(ledgerPath, {
      id: "mem-tashi-a",
      timestamp: "2026-06-03T00:00:00.000Z",
      actor: "agent:test",
      type: "fact",
      payload: { step: "A" },
      metadata: {},
    });

    const atomB = await appendAtom(ledgerPath, {
      id: "mem-tashi-b",
      timestamp: "2026-06-03T00:00:01.000Z",
      actor: "agent:test",
      type: "fact",
      payload: { step: "B" },
      metadata: {},
    });

    const consensus = new HashChainTashiConsensus("tashi:test");

    const root = await consensus.createVertex(atomA, []);
    const child = await consensus.createVertex(atomB, [root.hash]);

    await expect(consensus.verifyLineage(root)).resolves.toBe(true);
    await expect(consensus.verifyLineage(child)).resolves.toBe(true);
    await expect(consensus.validateConsensus([root, child])).resolves.toBe(true);
  });

  it("rejects tampered signatures and unknown parent lineage", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qag-membrain-tashi-"));
    cleanupTargets.push(dir);
    const ledgerPath = join(dir, "atoms.jsonl");

    const atom = await appendAtom(ledgerPath, {
      id: "mem-tashi-c",
      timestamp: "2026-06-03T00:00:02.000Z",
      actor: "agent:test",
      type: "fact",
      payload: { step: "C" },
      metadata: {},
    });

    const consensus = new HashChainTashiConsensus("tashi:test");
    const vertex = await consensus.createVertex(atom, []);

    const tamperedSignature = {
      ...vertex,
      signature: `${vertex.signature}bad`,
    };

    await expect(consensus.verifyLineage(tamperedSignature)).resolves.toBe(false);

    const unknownParentVertex = {
      ...vertex,
      parentHashes: ["missing-parent-hash"],
    };

    await expect(consensus.verifyLineage(unknownParentVertex)).resolves.toBe(false);
    await expect(consensus.validateConsensus([vertex, vertex])).resolves.toBe(false);
  });
});
