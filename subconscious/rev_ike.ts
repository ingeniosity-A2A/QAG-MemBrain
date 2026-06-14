import { AtomicMemory, ObservationProposal, TaskMemoryStore } from "../shared/types";

export class RevIke {
  constructor(private taskMemory: TaskMemoryStore) {}

  async detect(
    atom: AtomicMemory,
    _: { vectorSearch?: (embedding: number[], themes: string[]) => Promise<string[]> },
  ): Promise<ObservationProposal> {
    const vectorSearch = this.taskMemory as TaskMemoryStore & {
      searchVector?: (query: string, limit?: number) => Promise<Array<{ key: string; text: string }>>;
      putVector?: (key: string, text: string, metadata?: Record<string, unknown>) => Promise<void>;
    };

    const querySeed = `${atom.title} ${atom.content} ${atom.tags.join(" ")}`.trim();
    const chunks = vectorSearch.searchVector
      ? await vectorSearch.searchVector(querySeed, 5).catch(() => [])
      : [];

    const offPromptKey = chunks.length ? `ctx_${atom.id}` : undefined;
    if (offPromptKey && vectorSearch.putVector) {
      await vectorSearch.putVector(offPromptKey, JSON.stringify(chunks), {
        atom_id: atom.id,
        source: atom.source,
      });
    } else if (offPromptKey) {
      await this.taskMemory.set(offPromptKey, JSON.stringify(chunks));
    }

    return {
      id: atom.id,
      intent: atom.type,
      confidence: atom.metadata.confidence,
      payload: atom,
      anomaly: false,
      pattern: atom.type,
      insight: atom.title,
      proposed_action: "observe",
      off_prompt_context_key: offPromptKey,
    };
  }

  async readOffPromptContext(key: string): Promise<string | null> {
    const value = await this.taskMemory.get(key);
    return typeof value === "string" ? value : value == null ? null : JSON.stringify(value);
  }
}
