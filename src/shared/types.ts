// ═══════════════════════════════════════════════════════════════════
// QAG_MemBrain — Shared Types
// Canonical type definitions used across all layers
// ═══════════════════════════════════════════════════════════════════

export type AtomType =
  | "memory"
  | "event"
  | "task"
  | "observation"
  | "decision"
  | "lora_telemetry"
  | "nfc_tap"
  | "a2a_task"
  | "webhook"
  | "document"
  | "precedent";

export type AtomSource =
  | "system"
  | "nfc"
  | "a2a"
  | "cortex"
  | "web"
  | "agent"
  | "webhook"
  | "bluetooth"
  | "manual";

export type Importance = "low" | "medium" | "high" | "critical";

export type BrainTier = "reflex" | "executive" | "cortex";

export interface AtomicMemory {
  id: string;
  type: AtomType;
  source: AtomSource;
  timestamp: number;
  title: string;
  content: string;
  tags: string[];
  embedding: number[] | null;
  metadata: {
    confidence: number;
    importance: Importance;
    url?: string;
    author?: string;
    customer_did?: string;
    risk_level?: string;
    prefix_key?: string;
    edge_only?: boolean;
    [key: string]: unknown;
  };
  vertex_hash?: string;
  parent_hashes?: string[];
  signature?: string;
}

export interface CFGLResult {
  atom: AtomicMemory;
  routed_to: BrainTier;
  scored_importance: Importance;
  scored_confidence: number;
  ontology_tags: string[];
  passed_boundary: boolean;
}

export interface TashiVertex {
  hash: string;
  parents: string[];
  signature: string;
  creator: string;
  created_at: number;
  data: AtomicMemory & { vertex_hash: string; parent_hashes: string[] };
}

export interface TimelineDefinition {
  id: string;
  name: string;
  description: string;
  created_at: number;
}

export interface Neo4jMemoryNode {
  id: string;
  type: string;
  timestamp: number;
  content: string;
  importance: string;
  confidence: number;
  vertex_hash: string;
  embedding?: number[];
}

export interface TaskMemoryStore {
  get(key: string): Promise<unknown | null>;
  set(key: string, value: unknown, ttlMs?: number): Promise<void>;
  delete(key: string): Promise<void>;
  bufferSignal(signal: Record<string, unknown>): Promise<void>;
  flush(): Promise<Record<string, unknown>[]>;
  putVector?(key: string, text: string, metadata?: Record<string, unknown>): Promise<void>;
  searchVector?(query: string, limit?: number): Promise<Array<{ key: string; text: string; embedding?: number[]; metadata?: Record<string, unknown> }>>;
}

export interface ObservationProposal {
  atomId: string;
  observation: string;
  confidence: number;
  routingHint: BrainTier;
  tags: string[];
  offPromptKey?: string;
}

export interface PrecedentResult {
  matched: boolean;
  vertexHash: string;
  action: string;
  confidence: number;
}
