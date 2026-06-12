import { createAtomicMemory, JSONLMemoryStore } from "../jsonl/atomic_memory.js";

export class IngestionPipeline {
  constructor(private readonly memory: JSONLMemoryStore) {}

  async ingestText(content: string, source = "ingestion"): Promise<string> {
    const atom = createAtomicMemory({ type: "memory", source, content, metadata: { ingestion: true } });
    await this.memory.append(atom, "L1");
    return atom.id;
  }
}
