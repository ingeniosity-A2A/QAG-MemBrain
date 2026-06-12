export type Importance = "low" | "medium" | "high" | "critical";
export type BrainTier = "reflex" | "executive" | "cortex";
export type InputType =
  | "nfc_tap"
  | "a2a_post"
  | "webhook_known"
  | "document"
  | "user_message"
  | "agent_event"
  | "sensor"
  | "unknown";

export interface MemoryAtom {
  id: string;
  type: InputType;
  source: string;
  title: string;
  content: string;
  timestamp: number;
  tags: string[];
  embedding?: number[];
  metadata: {
    confidence: number;
    importance: Importance;
    url?: string;
    author?: string;
  };
  vertex_hash: string;
  signature: string;
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
  atom: MemoryAtom;
  dag_slice: MemoryAtom[];
  policy_context: string;
  intent: string;
  escalation_reason: string;
}
