import { AtomicMemory, TaskMemoryStore } from "../shared/types";

export interface ObservationProposalV2 {
 // v2.0 contract fields
 type: "observation_proposal";
 source: "REV.IKE";
 timestamp: number;
 id: string;
 intent: string;
 confidence: number;
 content: {
 interpretation: string;
 pattern?: string;
 question?: string;
 alternative_framing?: string;
 proposed_memory_content?: any;
 };
 anomaly: boolean;
 proposed_action: "observe" | "reject";
 off_prompt_context_key?: string;
 // Backward-compat (deprecated, remove after callers migrated)
 insight?: string;
 pattern?: string;
 payload?: any;
}

export class RevIke {
 constructor(private taskMemory: TaskMemoryStore) {}

 async detect(
 atom: AtomicMemory,
 _?: { vectorSearch?: (embedding: number[], themes: string[]) => Promise<string[]> },
 ): Promise<ObservationProposalV2> {
 const vectorSearch = this.taskMemory as TaskMemoryStore & {
 searchVector?: (query: string, limit?: number) => Promise<Array<{ key: string; text: string }>>;
 putVector?: (key: string, text: string, metadata?: Record<string, unknown>) => Promise<void>;
 };

 const querySeed = [atom.title, atom.content, ...atom.tags].join(" ").trim();
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
 type: "observation_proposal",
 source: "REV.IKE",
 timestamp: Date.now(),
 id: atom.id,
 intent: atom.type,
 confidence: atom.metadata.confidence,
 content: {
 interpretation: atom.title,
 pattern: atom.type,
 question: undefined,
 alternative_framing: undefined,
 proposed_memory_content: atom,
 },
 anomaly: false,
 proposed_action: "observe",
 off_prompt_context_key: offPromptKey,
 // deprecated aliases
 insight: atom.title,
 pattern: atom.type,
 payload: atom,
 };
 }

 async readOffPromptContext(key: string): Promise<string | null> {
 const value = await this.taskMemory.get(key);
 return typeof value === "string" ? value : value == null ? null : JSON.stringify(value);
 }
}
