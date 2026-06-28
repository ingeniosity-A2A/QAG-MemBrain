export type ImportanceLevel = "low" | "medium" | "high" | "critical";

export interface MemoryInput {
  type: string;
  content: string;
  tags?: string[];
  action?: string;
  metadata?: Record<string, unknown>;
}

export interface MemoryEvent extends MemoryInput {
  did: string;
  id: string;
  importance: ImportanceLevel;
  timestamp: string;
}

export interface SemanticMemoryEvent extends MemoryEvent {
  embedding: number[];
}

export interface HybridQueryOptions {
  limit?: number;
  semanticLimit?: number;
  tags?: string[];
  minScore?: number;
}

export interface HybridScoredEvent extends MemoryEvent {
  score: number;
  source: "semantic" | "metadata";
}

export interface HybridQueryResult {
  state: Record<string, unknown>;
  results: HybridScoredEvent[];
}
