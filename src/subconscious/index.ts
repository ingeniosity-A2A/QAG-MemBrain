import { MemoryStore, type MemoryEntry } from '../memory/jsonl/index.js';
import { GraphStore } from '../graph/neo4j/index.js';

export class WriteDeniedError extends Error {
  constructor(method: string) {
    super(`L5 Subconscious: ${method}() is forbidden. Layer 5 is read-only.`);
    this.name = 'WriteDeniedError';
  }
}

export class SubconsciousObserver {
  constructor(private memory: MemoryStore, private graph: GraphStore) {}

  observeMemory(from: number = 0, to: number = Infinity): ReadonlyArray<Readonly<MemoryEntry>> {
    return this.memory.readRange(from, to);
  }

  observeGraph(nodeId: string, depth: number = 3): ReturnType<GraphStore['traverse']> {
    return this.graph.traverse(nodeId, depth);
  }

  patternDensity(nodeId: string): number {
    const result = this.graph.traverse(nodeId, 3);
    return result.edges.length / Math.max(result.nodes.length, 1);
  }

  write(): never { throw new WriteDeniedError('write'); }
  decide(): never { throw new WriteDeniedError('decide'); }
  execute(): never { throw new WriteDeniedError('execute'); }
}
