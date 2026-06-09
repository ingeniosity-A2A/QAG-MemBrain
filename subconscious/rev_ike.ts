import { AtomicMemory, ObservationProposal, TaskMemoryStore } from "../shared/types";

export class RevIke {
  constructor(private taskMemory: TaskMemoryStore) {}

  async detect(
    atom: AtomicMemory,
    _: { vectorSearch?: (embedding: number[], themes: string[]) => Promise<string[]> },
  ): Promise<ObservationProposal> {
    return {
      id: atom.id,
      intent: atom.type,
      confidence: atom.metadata.confidence,
      payload: atom,
      anomaly: false,
      pattern: atom.type,
      insight: atom.title,
      proposed_action: "observe",
      off_prompt_context_key: undefined,
    };
  }

  async readOffPromptContext(key: string): Promise<string | null> {
    const value = await this.taskMemory.get(key);
    return typeof value === "string" ? value : value == null ? null : JSON.stringify(value);
  }
}
