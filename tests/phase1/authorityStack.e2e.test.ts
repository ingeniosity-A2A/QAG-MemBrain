import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { AuditEngine } from "../../audit/decisions/decisionRecord.js";
import { BasicGraphRag } from "../../graph/neo4j/graphrag/graphRag.js";
import { InMemoryCognitiveGraphRepository } from "../../graph/neo4j/repositories/cognitiveGraphRepository.js";
import { appendAtom, queryAtoms, readAtom, verifyAtom } from "../../memory/ledger/jsonlLedger.js";
import { ReplayEngine } from "../../temporal/replay/replayEngine.js";

const cleanupTargets: string[] = [];

afterEach(async () => {
  while (cleanupTargets.length > 0) {
    const path = cleanupTargets.pop();
    if (path) {
      await rm(path, { recursive: true, force: true });
    }
  }
});

describe("Phase 1 Authority Stack", () => {
  it("supports the end-to-end success path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qag-membrain-"));
    cleanupTargets.push(dir);
    const ledgerPath = join(dir, "atoms.jsonl");

    const atom = {
      id: "mem-001",
      timestamp: "2026-06-02T10:00:00.000Z",
      actor: "agent:planner",
      type: "decision_input",
      payload: { objective: "build foundations" },
      metadata: { source: "e2e-test" },
    };

    const appended = await appendAtom(ledgerPath, atom);
    expect(appended.hash.length).toBeGreaterThan(0);
    expect(appended.atomHash.length).toBeGreaterThan(0);
    expect(appended.proof).toEqual({
      id: atom.id,
      hash: appended.hash,
      timestamp: atom.timestamp,
    });

    const verified = await verifyAtom(ledgerPath, atom.id);
    expect(verified).toBe(true);

    const loaded = await readAtom(ledgerPath, atom.id);
    expect(loaded?.atom.actor).toBe("agent:planner");

    const filtered = await queryAtoms(ledgerPath, { actor: "agent:planner", type: "decision_input" });
    expect(filtered).toHaveLength(1);

    const graph = new InMemoryCognitiveGraphRepository();
    await graph.upsertNode({ id: atom.id, type: "Memory", properties: { atomId: atom.id } });
    await graph.upsertNode({ id: "decision-001", type: "Decision", properties: { label: "phase1" } });
    await graph.createRelationship({ fromId: atom.id, toId: "decision-001", type: "GENERATED" });

    const graphRag = new BasicGraphRag(graph);
    const context = await graphRag.collectContext(atom.id);
    expect(context.relatedNodeIds).toContain("decision-001");

    const replay = new ReplayEngine([
      {
        id: "evt-001",
        timestamp: "2026-06-02T10:00:00.000Z",
        decisionId: "decision-001",
        patch: { stage: "memory_stored" },
      },
      {
        id: "evt-002",
        timestamp: "2026-06-02T10:00:01.000Z",
        decisionId: "decision-001",
        patch: { stage: "decision_explained" },
      },
    ]);

    const snapshot = replay.seek("2026-06-02T10:00:01.000Z");
    expect(snapshot.state.stage).toBe("decision_explained");

    const audit = new AuditEngine();
    audit.append({
      decisionId: "decision-001",
      memories: [atom.id],
      policies: ["policy-immutability"],
      relationships: ["GENERATED"],
      timestamp: "2026-06-02T10:00:02.000Z",
      executionPath: ["reflex", "executive"],
    });

    const records = audit.list();
    expect(records).toHaveLength(1);
    expect(records[0].memories).toContain(atom.id);
  });

  it("enforces append-only ledger semantics", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qag-membrain-"));
    cleanupTargets.push(dir);
    const ledgerPath = join(dir, "atoms.jsonl");

    const atom = {
      id: "mem-fixed-id",
      timestamp: "2026-06-02T10:00:00.000Z",
      actor: "agent:test",
      type: "fact",
      payload: { version: 1 },
      metadata: {},
    };

    await appendAtom(ledgerPath, atom);
    await expect(appendAtom(ledgerPath, atom)).rejects.toThrow(/append-only/);
  });

  it("rejects atoms that do not satisfy JSON schema", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qag-membrain-"));
    cleanupTargets.push(dir);
    const ledgerPath = join(dir, "atoms.jsonl");

    const invalidAtom = {
      id: "mem-invalid-timestamp",
      timestamp: "not-a-date",
      actor: "agent:test",
      type: "fact",
      payload: { value: 1 },
      metadata: {},
    };

    await expect(appendAtom(ledgerPath, invalidAtom)).rejects.toThrow(/schema validation failed/i);
  });

  it("detects tampering through hash verification", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qag-membrain-"));
    cleanupTargets.push(dir);
    const ledgerPath = join(dir, "atoms.jsonl");

    const atom = {
      id: "mem-tamper-check",
      timestamp: "2026-06-02T10:00:00.000Z",
      actor: "agent:test",
      type: "fact",
      payload: { objective: "original" },
      metadata: {},
    };

    await appendAtom(ledgerPath, atom);
    const original = await verifyAtom(ledgerPath, atom.id);
    expect(original).toBe(true);

    const current = await readFile(ledgerPath, "utf8");
    const tampered = current.replace("\"objective\":\"original\"", "\"objective\":\"tampered\"");
    await writeFile(ledgerPath, tampered, "utf8");

    const verifiedAfterTamper = await verifyAtom(ledgerPath, atom.id);
    expect(verifiedAfterTamper).toBe(false);
  });
});
