import { AtomicMemory, PrecedentResult } from "../shared/types";
import { MemBrainGraph } from "../retrieval/neo4j_graph";

export class OperatorFusion {
  constructor(private graph: MemBrainGraph) {}

  async fetchPrecedents(query: string, limit = 5): Promise<PrecedentResult[]> {
    const nodes = await this.graph.graphRagSearch([], query, limit, 1).catch(() => []);
    return nodes.map((entry) => ({
      matched: true,
      vertexHash: entry.atom.vertex_hash,
      action: "precedent_match",
      confidence: entry.score,
    }));
  }

  formatPrecedentsForPrompt(precedents: PrecedentResult[]): string {
    if (!precedents.length) return "none";
    return precedents
      .map((p, i) => `${i + 1}. matched=${p.matched} action=${p.action ?? "n/a"} conf=${p.confidence}`)
      .join("\n");
  }

  async captureOverride(_: {
    proposedAction: Record<string, unknown>;
    overrideAction: Record<string, unknown>;
    context: string;
    tags: string[];
  }): Promise<void> {
    return;
  }
}
