export type TemporalCoordinate = number;
export type TemporalSpan = number;
export type EasingWavefunction = (t: number) => number;

export type AtomType =
  | "event" | "note" | "article" | "task" | "memory"
  | "conversation" | "code" | "sensor" | "vision" | "precedent"
  | "policy_update" | "audit" | "tween_atom";

export type AtomSource =
  | "user" | "system" | "web" | "agent" | "vision"
  | "nfc" | "a2a" | "webhook" | "cortex" | "reflex" | "executive";

export type Importance = "low" | "medium" | "high" | "critical";
export type BrainTier = "reflex" | "executive" | "cortex";

export interface AtomicMemory {
  id: string;
  type: AtomType;
  source: AtomSource;
  timestamp: TemporalCoordinate;
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
    risk_level?: "low" | "medium" | "high";
    riskLevel?: "low" | "medium" | "high";
    edge_only?: boolean;
    prefix_key?: string;
    vertex_hash?: string;
    parent_hashes?: string[];
  };
  vertex_hash?: string;
  signature?: string;
  parent_hashes?: string[];
  fingerprint?: string;
  supersedes?: string;
  tombstone_of?: string;
}

export interface TweenAtom {
  id: string;
  target_memory_id: string;
  property: string;
  from_value: number;
  to_value: number;
  start_time: TemporalCoordinate;
  end_time: TemporalCoordinate;
  easing_name: string;
  easing_wavefunction: EasingWavefunction;
  cognitive_weight: number;
  signature?: string;
}

export interface TashiVertex {
  hash: string;
  parents: string[];
  signature: string;
  creator: string;
  created_at: TemporalCoordinate;
  data: AtomicMemory;
}

export interface Neo4jMemoryNode {
  id: string;
  type: AtomType;
  timestamp: TemporalCoordinate;
  content: string;
  importance: Importance;
  confidence: number;
  embedding: number[] | null;
  vertex_hash: string;
}

export interface TimelineDefinition {
  id: string;
  session_id: string;
  atoms: TweenAtom[];
  start_time: TemporalCoordinate;
  labels: Record<string, TemporalCoordinate>;
  created_at: TemporalCoordinate;
  vertex_hash?: string;
}

export interface ReconstructedState {
  memory_id: string;
  temporal_coordinate: TemporalCoordinate;
  state: Record<string, number>;
  fidelity: number;
  reconstruction_ms: number;
  timeline_hash: string;
}

export interface SuperpositionGroup {
  id: string;
  possibilities: Array<{
    state: Record<string, number>;
    weight: number;
    label: string;
    atom_id: string;
  }>;
  is_collapsed: boolean;
  collapsed_to?: string;
  collapsed_at?: TemporalCoordinate;
}

export interface BrainResult {
  tier: BrainTier;
  atom_id: string;
  action: string;
  output: Record<string, unknown>;
  confidence: number;
  model_used: string;
  latency_ms: number;
  escalate: boolean;
  escalation_reason?: string;
}

export interface CortexPacket {
  atom: AtomicMemory;
  dag_slice: AtomicMemory[];
  timeline_slice: TweenAtom[];
  policy_context: string;
  intent: string;
  escalation_reason: string;
}

export interface GateConfig {
  reflex_pass_confidence: number;
  reflex_known_types: AtomSource[];
  executive_pass_confidence: number;
  executive_max_dag_depth: number;
  last_updated: TemporalCoordinate;
  version: number;
}

export const DEFAULT_GATE_CONFIG: GateConfig = {
  reflex_pass_confidence: 0.85,
  reflex_known_types: ["nfc", "webhook", "a2a"],
  executive_pass_confidence: 0.6,
  executive_max_dag_depth: 5,
  last_updated: Date.now(),
  version: 1,
};

export interface CFGLResult {
  atom: AtomicMemory;
  routed_to: BrainTier;
  scored_importance: Importance;
  scored_confidence: number;
  ontology_tags: string[];
  passed_boundary: boolean;
}

export interface ObservationProposal {
  id?: string;
  intent: string;
  confidence: number;
  payload: unknown;
  cachedTweenHash?: string;
  anomaly?: boolean;
  pattern?: string;
  insight?: string;
  proposed_action?: string;
  off_prompt_context_key?: string;
}

export interface AVA007Decision {
  id?: string;
  decided_by?: string;
  layer?: string;
  timestamp?: number;
  proposal_id?: string;
  action: string;
  params: Record<string, unknown>;
  delegatedTo?: "goose" | "rev_ike" | "executive";
  escalate: boolean;
  confidence: number;
  reason: string;
  memory_action?: string;
  outcome?: "ACCEPT" | "REJECT";
  rationale?: string;
  precedents_used?: PrecedentResult[];
}

export interface AtomMemDirective {
  action?: "create_memory" | "read_memory" | "update_memory" | "delete_memory";
  operation?: "create" | "read" | "query";
  filter?: Partial<AtomicMemory>;
  newAtom?: AtomicMemory;
  atom_id?: string;
  payload?: Record<string, unknown>;
  rationale?: string;
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
  putVector?(key: string, text: string, metadata?: Record<string, unknown>): Promise<void>;
  semanticSearch?(query: string, limit?: number): Promise<Array<{ key: string; text: string; embedding: number[]; metadata: Record<string, unknown> }>>;
}
