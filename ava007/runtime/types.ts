import type { Driver, Record as Neo4jRecord } from "neo4j-driver";
import { DagPathProvenance } from "../../memory/jsonl/provenance.js";

export type RuntimeTier = "reflex" | "executive" | "cortex";

export type AtomImportance = "low" | "medium" | "high" | "critical";

export type RuntimeAction =
  | "ignore"
  | "resolve_nfc_tap"
  | "resolve_webhook"
  | "resolve_cached_tween"
  | "executive_action"
  | "escalate_to_cortex"
  | "cortex_action";

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

export interface ProcessAtomDeps {
  neo4j: Driver;
  mellum2: Mellum2Client;
  mercury2: Mercury2Client;
  auditLogPath: string;
  gateConfig?: GateConfig;
  now?: () => Date;
  gsapTweenCache?: GsapTweenCache;
  fingerprintCache?: FingerprintCache;
}

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

export interface GsapTweenCache {
  has(patternHash: string): boolean;
}

export interface FingerprintCache {
  has(fingerprint: string): boolean;
}

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

export interface PolicyConflict {
  policyId: string;
  policyVersion?: string;
  conflictsWithId: string;
  conflictsWithVersion?: string;
  reason?: string;
}

export interface Mellum2Request {
  atom: Atom;
  dagSlice: DagSlice;
  policyConflicts: PolicyConflict[];
  gateConfig: GateConfig;
}

export interface Mellum2Response {
  decision: RuntimeAction | "escalate_to_cortex";
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

export interface AuditAtom {
  id: string;
  type: "policy_change";
  source: "cortex";
  timestamp: string;
  predecessorAtomId: string;
  packetId: string;
  payload: Record<string, unknown>;
  provenance?: DagPathProvenance;
}

export function assertAtom(atom: Atom): void {
  if (!atom.id || !atom.type || !atom.source || typeof atom.payload !== "object" || atom.payload === null) {
    throw new Error("Atom is incomplete");
  }
}

export function neo4jString(record: Neo4jRecord, key: string): string {
  const value = record.get(key);
  if (typeof value !== "string") {
    throw new Error(`Neo4j field '${key}' must be a string`);
  }
  return value;
}

export function neo4jOptionalString(record: Neo4jRecord, key: string): string | undefined {
  const value = record.get(key);
  if (value === null || typeof value === "undefined") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`Neo4j field '${key}' must be a string when present`);
  }
  return value;
}

export function neo4jProperties(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}
