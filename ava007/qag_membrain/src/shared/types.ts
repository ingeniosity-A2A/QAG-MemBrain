// ═══════════════════════════════════════════════════════════════════
// QUANTUM ATOMIC GSAP MEMBRAiN — Canonical Type Definitions
// Single source of truth. All modules import from here.
// ═══════════════════════════════════════════════════════════════════

// ─── Temporal Primitives ────────────────────────────────────────────
export type TemporalCoordinate = number;   // Unix ms — globally monotonic
export type TemporalSpan = number;         // Duration in ms
export type EasingWavefunction = (t: number) => number; // [0,1] → [0,1]

// ─── Atom Classification ────────────────────────────────────────────
export type AtomType =
  | "event" | "note" | "article" | "task" | "memory"
  | "conversation" | "code" | "sensor" | "vision"
  | "policy_update" | "audit" | "tween_atom";

export type AtomSource =
  | "user" | "system" | "web" | "agent" | "vision"
  | "nfc" | "a2a" | "webhook" | "cortex" | "reflex" | "executive";

export type Importance = "low" | "medium" | "high" | "critical";
export type BrainTier  = "reflex" | "executive" | "cortex";

// ─── JSONL Atomic Memory (Layer 0) ──────────────────────────────────
// Golden Rule: one object = one atomic memory.
// Never store a whole document as a single record.
export interface AtomicMemory {
  id:        string;                // UUID — assigned at ingestion
  type:      AtomType;
  source:    AtomSource;
  timestamp: TemporalCoordinate;   // Canonical ingestion time — never user-supplied
  title:     string;               // Short human-readable label
  content:   string;               // Clean text or summary
  tags:      string[];
  embedding: number[] | null;      // 1536-dim vector, null until indexed
  metadata: {
    confidence:    number;         // 0.0–1.0 — computed at ingestion
    importance:    Importance;
    url?:          string;
    author?:       string;
    customer_did?: string;         // DID of originating entity
    risk_level?:   "low" | "medium" | "high";
  };
  // Added by Tashi Layer 1 after signing
  vertex_hash?: string;            // SHA-256 of signed atom
  signature?:   string;           // Ed25519 signature
  parent_hashes?: string[];        // DAG parent references
}

// ─── Tween Atom (Layer 2 — GSAP Temporal Substrate) ─────────────────
// A TweenAtom is an AtomicMemory with type="tween_atom"
// that encodes a law of state transition, not a state snapshot.
// value(t) = from + (to - from) × easingWavefunction(normalize(t, startTime, endTime))
export interface TweenAtom {
  id:                string;
  target_memory_id:  string;         // Which AtomicMemory this transitions
  property:          string;         // Property being transitioned
  from_value:        number;
  to_value:          number;
  start_time:        TemporalCoordinate;
  end_time:          TemporalCoordinate;
  easing_name:       string;         // e.g. "power2.out", "elastic.out"
  easing_wavefunction: EasingWavefunction;
  cognitive_weight:  number;         // Attention/importance weighting [0,1]
  signature?:        string;         // DID-signed for provenance
}

// ─── Tashi Vertex (Layer 1 — DAG Consensus) ─────────────────────────
export interface TashiVertex {
  hash:         string;             // SHA-256 of (data + parents + creator)
  parents:      string[];           // Parent vertex hashes — empty for genesis
  signature:    string;             // Ed25519 by creator DID
  creator:      string;             // DID of originating node
  created_at:   TemporalCoordinate;
  data:         AtomicMemory;       // The JSONL atom payload
}

// ─── Neo4j Node Shapes ───────────────────────────────────────────────
export interface Neo4jMemoryNode {
  id:        string;
  type:      AtomType;
  timestamp: TemporalCoordinate;
  content:   string;
  importance: Importance;
  confidence: number;
  embedding:  number[] | null;      // Stored as Neo4j vector property
  vertex_hash: string;
}

// ─── GSAP Timeline Definition (serializable) ─────────────────────────
// The complete law of change for a cognitive session.
// Two nodes given identical TimelineDefinition + start_time
// produce identical state at any future temporal coordinate.
export interface TimelineDefinition {
  id:          string;
  session_id:  string;
  atoms:       TweenAtom[];
  start_time:  TemporalCoordinate;
  labels:      Record<string, TemporalCoordinate>; // Named temporal anchors
  created_at:  TemporalCoordinate;
  vertex_hash?: string;            // Tashi hash after gossip
}

// ─── Holographic Memory State ─────────────────────────────────────────
export interface ReconstructedState {
  memory_id:           string;
  temporal_coordinate: TemporalCoordinate;
  state:               Record<string, number>;
  fidelity:            number;       // 1.0 = perfect lossless replay
  reconstruction_ms:   number;
  timeline_hash:       string;
}

// ─── Superposition Group ─────────────────────────────────────────────
// Multiple concurrent states existing until observation collapses them.
export interface SuperpositionGroup {
  id:           string;
  possibilities: Array<{
    state:   Record<string, number>;
    weight:  number;               // Probability weight [0,1], sum = 1
    label:   string;
    atom_id: string;
  }>;
  is_collapsed: boolean;
  collapsed_to?: string;           // atom_id of selected state
  collapsed_at?: TemporalCoordinate;
}

// ─── Brain Layer Types ────────────────────────────────────────────────
export interface BrainResult {
  tier:               BrainTier;
  atom_id:            string;
  action:             string;
  output:             Record<string, unknown>;
  confidence:         number;
  model_used:         string;
  latency_ms:         number;
  escalate:           boolean;
  escalation_reason?: string;
}

// Complete context packet assembled by Executive before Mercury 2 call.
// MUST be complete — diffusion generation cannot be steered mid-call.
export interface CortexPacket {
  atom:               AtomicMemory;
  dag_slice:          AtomicMemory[];     // Neo4j ancestor traversal
  timeline_slice:     TweenAtom[];        // Relevant GSAP atoms
  policy_context:     string;
  intent:             string;
  escalation_reason:  string;
}

// ─── Gate Configuration (cortex learning loop updates these) ─────────
export interface GateConfig {
  reflex_pass_confidence:   number;       // Default 0.85
  reflex_known_types:       AtomSource[]; // Types reflex handles without LLM
  executive_pass_confidence: number;      // Default 0.60
  executive_max_dag_depth:  number;       // Default 5
  last_updated:             TemporalCoordinate;
  version:                  number;
}

export const DEFAULT_GATE_CONFIG: GateConfig = {
  reflex_pass_confidence:    0.85,
  reflex_known_types:        ["nfc", "webhook", "a2a"],
  executive_pass_confidence: 0.60,
  executive_max_dag_depth:   5,
  last_updated:              Date.now(),
  version:                   1,
};

// ─── Spatial Memory Palace ────────────────────────────────────────────
export interface SpatialAddress {
  x: number; y: number; z: number;   // 3D position in memory palace
  scroll_offset: number;              // ScrollTrigger coordinate
  acoustic_signature: {
    pan:      number;   // L/R: lateral cognitive position
    elevation: number;  // Abstract/concrete hierarchy
    distance:  number;  // Relevance (near=active, far=dormant)
    reverb:   number;   // Memory depth (dry=recent, wet=deep)
    frequency: number;  // Cognitive type (low=procedural, high=episodic)
  };
}

// ─── Rev. Ike Boundary Types (CFGL — subconscious filter) ────────────
// This is the boundary between raw input absorption and conscious reasoning.
// CFGL scores and routes. It does not decide. The brain decides.
export interface CFGLResult {
  atom:          AtomicMemory;
  routed_to:     BrainTier;
  scored_importance: Importance;
  scored_confidence: number;
  ontology_tags: string[];
  passed_boundary: boolean;  // true = enters brain layer
}
