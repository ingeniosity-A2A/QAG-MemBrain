import { createHash } from "crypto";
import { appendAtom, readAtoms } from "../memory/atomic_memory";
import { AtomicMemory, PrecedentResult } from "../shared/types";
import { MemBrainGraph } from "../retrieval/neo4j_graph";

export class OperatorFusion {
  constructor(private graph: MemBrainGraph, private precedentPath = "./memory/precedents.jsonl") {}

  async fetchPrecedents(query: string, limit = 5): Promise<PrecedentResult[]> {
    const nodes = await this.graph.graphRagSearch([], query, limit, 1).catch(() => []);
    const graphPrecedents = nodes.map((entry) => ({
      matched: true,
      vertexHash: entry.atom.vertex_hash,
      action: "precedent_match",
      confidence: entry.score,
    }));
    const persisted: AtomicMemory[] = [];
    try {
      for await (const atom of readAtoms(this.precedentPath)) {
        persisted.push(atom);
      }
    } catch {
      // Missing file is fine; precedents are optional on first run.
    }
    const diskPrecedents = persisted
      .filter((atom) => atom.type === "precedent")
      .filter((atom) => atom.content.includes(query) || atom.tags.some((tag) => query.includes(tag)))
      .slice(0, limit)
      .map((atom) => ({
        matched: true,
        vertexHash: atom.vertex_hash,
        action: atom.metadata?.vertex_hash ? String(atom.metadata.vertex_hash) : "persisted_precedent",
        confidence: atom.metadata.confidence ?? 0.5,
      }));
    return [...graphPrecedents, ...diskPrecedents].slice(0, limit);
  }

  formatPrecedentsForPrompt(precedents: PrecedentResult[]): string {
    if (!precedents.length) return "none";
    return precedents
      .map((p, i) => `${i + 1}. matched=${p.matched} action=${p.action ?? "n/a"} conf=${p.confidence}`)
      .join("\n");
  }

  async captureOverride(input: {
    proposedAction: Record<string, unknown>;
    overrideAction: Record<string, unknown>;
    context: string;
    tags: string[];
  }): Promise<void> {
    const content = JSON.stringify({
      proposedAction: input.proposedAction,
      overrideAction: input.overrideAction,
      context: input.context,
    });
    const atom: AtomicMemory = {
      id: createHash("sha256").update(content + Date.now()).digest("hex").slice(0, 26),
      type: "precedent",
      source: "agent",
      timestamp: Date.now(),
      title: "Operator override precedent",
      content,
      tags: ["precedent", ...input.tags],
      embedding: null,
      metadata: {
        confidence: 1.0,
        importance: "medium",
        risk_level: "low",
      },
    };
    await appendAtom(atom, this.precedentPath);
  }
}
