export type AuthorityLayer = "L1" | "L2" | "L3" | "L4" | "L5" | "L6";

export interface TemporalCognitionSignature {
  timelineId: string;
  time: number;
  seed: string;
  velocity: number;
}

export interface AtomicMemory {
  id: string;
  type: "event" | "note" | "task" | "memory" | "policy" | "audit" | "quantum";
  source: string;
  timestamp: string;
  content: string;
  embedding?: number[];
  metadata: Record<string, unknown>;
  fingerprint?: string;
  signature?: string;
  layer?: AuthorityLayer;
}

export interface InteractionQuantum extends AtomicMemory {
  type: "quantum";
  rf_physical?: {
    frequency_hz: number;
    rssi_dbm: number;
    snr_db: number;
  };
  crypto_routing?: {
    creator: string;
    route?: string[];
    encrypted?: boolean;
  };
  temporal_index?: {
    gsap_ticker_ms: number;
    doppler_hz: number;
  };
  t_slat?: number[];
}

export interface ObservationProposal {
  id: string;
  observed_by: "Rev.Ike";
  intent: string;
  confidence: number;
  proposed_memory?: AtomicMemory;
  context: Record<string, unknown>;
}

export interface AvaDecision {
  id: string;
  decided_by: "Ava007";
  accepted: boolean;
  reason: string;
  proposal_id: string;
  committed_memory_id?: string;
}

export interface TashiVertex {
  hash: string;
  parents: string[];
  signature: TemporalCognitionSignature;
  payload: unknown;
  creator: string;
  timestamp: number;
}

export interface Revelation {
  diagnosis: string;
  tactical_directive: string;
  memories: AtomicMemory[];
}
