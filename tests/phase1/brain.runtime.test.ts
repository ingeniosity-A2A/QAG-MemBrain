import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AuditEngine } from "../../audit/decisions/decisionRecord.js";
import { BasicExecutiveRuntime } from "../../brain/executive/runtime.js";
import { BasicReflexRuntime } from "../../brain/reflex/runtime.js";
import { InMemoryCognitiveGraphRepository } from "../../graph/neo4j/repositories/cognitiveGraphRepository.js";
import { appendAtom, queryAtoms } from "../../memory/ledger/jsonlLedger.js";

const cleanupTargets: string[] = [];

afterEach(async () => {
  while (cleanupTargets.length > 0) {
    const path = cleanupTargets.pop();
    if (path) {
      await rm(path, { recursive: true, force: true });
    }
  }
});

describe("Brain runtime pipeline", () => {
  it("executes reflex to executive to audit with memory and graph context", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qag-membrain-brain-"));
    cleanupTargets.push(dir);
    const ledgerPath = join(dir, "atoms.jsonl");

    const atom = {
      id: "mem-brain-001",
      timestamp: "2026-06-03T02:00:00.000Z",
      actor: "agent:runtime",
      type: "decision_input",
      payload: { objective: "plan and record" },
      metadata: { source: "brain-runtime-test" },
    };

    await appendAtom(ledgerPath, atom);

    const graph = new InMemoryCognitiveGraphRepository();
    await graph.createNode({ id: atom.id, type: "Memory", properties: { embedding: [1, 0, 0] } });
    await graph.createNode({ id: "decision-brain-001", type: "Decision", properties: {} });
    await graph.createRelationship({
      fromId: atom.id,
      toId: "decision-brain-001",
      type: "GENERATED",
      properties: { source: "brain-runtime-test" },
    });

    const reflex = new BasicReflexRuntime();
    const route = await reflex.route(atom.type, { memoryId: atom.id });
    expect(route).toBe("executive:plan");

    const memories = await queryAtoms(ledgerPath, { type: "decision_input" });
    expect(memories).toHaveLength(1);

    const graphContext = await graph.getContext(atom.id, "GENERATED");
    expect(graphContext.relatedNodeIds).toContain("decision-brain-001");

    const audit = new AuditEngine();
    const executive = new BasicExecutiveRuntime(audit);

    const plan = await executive.plan("evaluate objective", {
      memory: memories[0].atom,
      graphContext,
      route,
    });

    expect(plan).toContain("memory_lookup");
    expect(plan).toContain("graph_context");
    expect(plan).toContain("audit_record");

    await executive.orchestrate(plan);
    executive.recordDecision(
      "decision-brain-001",
      [memories[0].atom.id],
      graphContext.outgoing.map((relationship) => relationship.type),
      ["reflex", "executive"],
      ["policy-immutability"],
    );

    const records = audit.list();
    expect(records).toHaveLength(1);
    expect(records[0].memories).toContain(atom.id);
    expect(records[0].executionPath).toEqual(["reflex", "executive"]);
  });
});
