/**
 * Ava007 Coordination Layer – Types
 * Ported from ava007/runtime/types.ts into canonical src/ structure.
 * All imports are self-contained (no references to broken root-level modules).
 */

// ─── Runtime Tiers ───────────────────────────────────────────────────

export type RuntimeTier = 'reflex' | 'executive' | 'cortex';
export type AtomImportance = 'low' | 'medium' | 'high' | 'critical';

export type RuntimeAction =
  | 'ignore'
  | 'resolve_nfc_tap'
  | 'resolve_webhook'
  | 'resolve_cached_tween'
  | 'executive_action'
  | 'escalate_to_cortex'
  | 'cortex_action';

// ─── Atom (input to coordination loop) ───────────────────────────────

export interface Atom {
  id: string;
  type: string;
  source: string;
  payload: Record<string, unknown>;
  createdAt?: string;
  sha256?: string;
  confidence?: number;
  importance?: AtomImportance;
  tags?: string[];
  policyIds?: string[];
  multiAtomContextRequired?: boolean;
  unresolvedDagDependencyIds?: string[];
}

// ─── Gate Config ─────────────────────────────────────────────────────

export interface GateConfig {
  reflexNfcSources: string[];
  reflexWebhookSources: string[];
  reflexKnownWebhookTypes: string[];
  reflexKnownPatternTypes: string[];
  reflexConfidenceThreshold: number;
  reflexMaxPayloadBytes: number;
  reflexContextTokenBudget: number;
  executiveContextTokenBudget: number;
  cortexContextTokenBudget: number;
  executiveEscalationConfidence: number;
  dagMaxDepth: number;
  activePolicyVersion?: string;
}

// ─── DAG Slice ───────────────────────────────────────────────────────

export interface DagNode {
  id: string;
  labels: string[];
  properties: Record<string, unknown>;
  depth: number;
}

export interface DagRelationship {
  fromId: string;
  toId: string;
  type: string;
  properties: Record<string, unknown>;
  depth: number;
}

export interface DagSlice {
  rootId: string;
  maxDepth: number;
  nodes: DagNode[];
  relationships: DagRelationship[];
}

// ─── Policy Conflict ─────────────────────────────────────────────────

export interface PolicyConflict {
  policyId: string;
  policyVersion?: string;
  conflictsWithId: string;
  conflictsWithVersion?: string;
  reason?: string;
}

// ─── Mellum2 (Executive LLM) ────────────────────────────────────────

export interface Mellum2Request {
  atom: Atom;
  dagSlice: DagSlice;
  policyConflicts: PolicyConflict[];
  gateConfig: GateConfig;
}

export interface Mellum2Response {
  decision: RuntimeAction | 'escalate_to_cortex';
  action: RuntimeAction;
  confidence: number;
  reason: string;
  subAgentDelegationSufficient?: boolean;
  policyChangeRequired?: boolean;
  proposedPolicy?: Record<string, unknown>;
}

export interface Mellum2Client {
  evaluate(request: Mellum2Request): Promise<Mellum2Response>;
}

// ─── Mercury 2 (Cortex LLM) ─────────────────────────────────────────

export interface CortexPacket {
  packetId: string;
  atom: Atom;
  dagSlice: DagSlice;
  policyConflicts: PolicyConflict[];
  executiveDecision: Mellum2Response;
  gateConfig: GateConfig;
  assembledAt: string;
}

export interface Mercury2Request {
  packet: CortexPacket;
  prompt: string;
}

export interface Mercury2Response {
  action: RuntimeAction;
  confidence: number;
  block: string;
  policyChange?: Record<string, unknown>;
}

export interface Mercury2Client {
  generateBlock(request: Mercury2Request): Promise<Mercury2Response>;
}

// ─── Audit ───────────────────────────────────────────────────────────

export interface AuditAtom {
  id: string;
  type: 'policy_change';
  source: 'cortex';
  timestamp: string;
  predecessorAtomId: string;
  packetId: string;
  payload: Record<string, unknown>;
}

// ─── Process Result ──────────────────────────────────────────────────

export interface ProcessAtomResult {
  tier: RuntimeTier;
  action: RuntimeAction;
  latencyMs: number;
  confidence?: number;
  packetId?: string;
  auditAtomId?: string;
  gateReason?: string;
  contextTokenBudget?: number;
}

// ─── Escalation Gate Decisions ───────────────────────────────────────

export type ReflexGateReason =
  | 'known_nfc_shape'
  | 'known_webhook_shape'
  | 'cached_a2a_task'
  | 'fingerprint_cache_hit'
  | 'gsap_tween_cache_hit'
  | 'explicit_cortex_request'
  | 'explicit_executive_request'
  | 'document_upload'
  | 'critical_importance'
  | 'ingestion_confidence_below_threshold'
  | 'importance_above_reflex'
  | 'multi_atom_context_required'
  | 'unresolved_dag_dependencies'
  | 'policy_context_required'
  | 'payload_over_reflex_budget'
  | 'unknown_shape';

export type ExecutiveGateReason =
  | 'mellum_confidence_below_threshold'
  | 'mellum_requested_cortex'
  | 'critical_importance'
  | 'novel_type_without_dag_match'
  | 'policy_conflict_detected'
  | 'novel_policy_required'
  | 'dag_path_missing'
  | 'sub_agent_delegation_insufficient'
  | 'importance_outside_executive'
  | 'executive_completed';

export interface ReflexGateDecision {
  target: 'reflex' | 'executive';
  reason: ReflexGateReason;
  action?: RuntimeAction;
  patternHash: string;
  payloadBytes: number;
  confidence: number;
  threshold: number;
  importance: AtomImportance;
}

export interface ExecutiveGateDecision {
  target: 'executive' | 'cortex';
  reason: ExecutiveGateReason;
  confidence: number;
  threshold: number;
  policyConflictCount: number;
  dagNodeCount: number;
  dagPathExists: boolean;
}

// ─── Executive Result ────────────────────────────────────────────────

export interface ExecutiveResult {
  decision: Mellum2Response;
  gate: ExecutiveGateDecision;
  packet?: CortexPacket;
}

// ─── Cache interfaces ────────────────────────────────────────────────

export interface PatternCache {
  has(patternHash: string): boolean;
}

export interface FingerprintCache {
  has(fingerprint: string): boolean;
}

// ─── Assertion ───────────────────────────────────────────────────────

export function assertAtom(atom: Atom): void {
  if (!atom.id || !atom.type || !atom.source || typeof atom.payload !== 'object' || atom.payload === null) {
    throw new Error('Atom is incomplete: id, type, source, and payload are required.');
  }
}
