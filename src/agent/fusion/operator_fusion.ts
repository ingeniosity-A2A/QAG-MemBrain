import { createHash } from "crypto";
import { appendFile, readFile } from "fs/promises";
import { AtomicMemory, ObservationProposal, PrecedentResult } from "../../shared/types.js";
import { MemBrainGraph } from "../../memory/retrieval/neo4j_graph.js";

/** Append an AtomicMemory as a JSONL line to a file. */
async function appendAtom(atom: AtomicMemory, path: string): Promise<void> {
  const line = JSON.stringify(atom) + '\n';
  await appendFile(path, line, 'utf-8');
}

/** Read AtomicMemory entries from a JSONL file. */
async function* readAtoms(path: string): AsyncGenerator<AtomicMemory> {
  let content: string;
  try {
    content = await readFile(path, 'utf-8');
  } catch {
    return;
  }
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      yield JSON.parse(line) as AtomicMemory;
    } catch {
      // Skip malformed lines.
    }
  }
}

export class OperatorFusion {
  constructor(private graph: MemBrainGraph, private precedentPath = "./memory/precedents.jsonl") {}

  async fetchPrecedents(query: string, limit = 5): Promise<PrecedentResult[]> {
    const nodes = await this.graph.graphRagSearch([], query, limit, 1).catch(() => []);
    const graphPrecedents = nodes.map((entry: any) => ({
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
      .filter((atom) => atom.content.includes(query) || atom.tags.some((tag: any) => query.includes(tag)))
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

  async captureOverride(proposal: ObservationProposal, rejectedBy: string, reason: string): Promise<void> {
    const content = JSON.stringify({
      intent: proposal.intent,
      confidence: proposal.confidence,
      payload: proposal.payload,
      rejectedBy,
      reason,
    });
    const atom: AtomicMemory = {
      id: createHash("sha256").update(content + Date.now()).digest("hex").slice(0, 26),
      type: "precedent",
      source: "agent",
      timestamp: Date.now(),
      title: "Operator override precedent",
      content,
      tags: ["precedent", rejectedBy],
      embedding: null,
      metadata: {
        confidence: 1.0,
        importance: "medium",
        risk_level: "low",
        edge_only: false,
      },
    };
    await appendAtom(atom, this.precedentPath);
  }
}
