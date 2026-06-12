import { enforceMaxDepth } from "../../contract/enforcement.js";
import { AtomicMemory, Revelation } from "../../shared/types.js";

export class AtomicInteractionGraph {
  private readonly memories = new Map<string, AtomicMemory>();

  async store(memory: AtomicMemory): Promise<void> {
    this.memories.set(memory.id, memory);
  }

  transformQuery(query: string): string {
    const normalized = query.toLowerCase();
    if (normalized.includes("stalled") || normalized.includes("blocked")) return "illusion of obstacles";
    if (normalized.includes("latency")) return "collapse of executive time";
    return normalized;
  }

  async retrieveRevelation(query: string, depth = 2): Promise<Revelation> {
    enforceMaxDepth(depth);
    const transformed = this.transformQuery(query);
    const memories = [...this.memories.values()].filter((memory) =>
      `${memory.content} ${JSON.stringify(memory.metadata)}`.toLowerCase().includes(transformed.split(" ")[0]),
    );
    return {
      diagnosis: transformed,
      tactical_directive: memories.length > 0 ? "act on the nearest verified quantum" : "collect one more edge observation",
      memories,
    };
  }
}
