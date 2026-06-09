export interface AtomicMemory {
  id: string;
  type: "event" | "note" | "article" | "task" | "memory" | "conversation" | "code";
  source: "user" | "system" | "web" | "agent" | "vision" | "nfc";
  timestamp: string;
  title: string;
  content: string;
  tags: string[];
  embedding: number[] | null;
  metadata: {
    url?: string;
    author?: string;
    confidence: number;
    importance: "low" | "medium" | "high" | "critical";
    customer_did?: string;
    riskLevel?: "low" | "medium" | "high";
    vertex_hash?: string;
    parent_hashes?: string[];
  };
}

export interface TashiVertex {
  hash: string;
  parents: string[];
  signature: string;
  creator: string;
  created_at: number;
  data: AtomicMemory;
}

export interface ObservationProposal {
  intent: string;
  confidence: number;
  payload: unknown;
  cachedTweenHash?: string;
}

export interface AVA007Decision {
  action: string;
  params: Record<string, unknown>;
  delegatedTo?: "goose" | "rev_ike" | "executive";
  escalate: boolean;
  confidence: number;
  reason: string;
}

export interface AtomMemDirective {
  operation: "create" | "read" | "query";
  filter?: Partial<AtomicMemory>;
  newAtom?: AtomicMemory;
}

export interface PrecedentResult {
  matched: boolean;
  vertexHash?: string;
  action?: string;
  confidence: number;
}

export interface InMemoryTaskStore {
  get(key: string): Promise<unknown | null>;
  set(key: string, value: unknown, ttlMs?: number): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface TaskMemoryStore extends InMemoryTaskStore {
  bufferSignal(signal: Record<string, unknown>): Promise<void>;
  flush(): Promise<Record<string, unknown>[]>;
}
