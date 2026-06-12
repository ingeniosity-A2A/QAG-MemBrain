import { Atom, RuntimeAction } from "./types.js";

export type ContextTier =
  | "listener"
  | "cfgl"
  | "control_plane"
  | "executive"
  | "cortex"
  | "device"
  | "edge";

export type EndpointId = "mellum2" | "mercury2" | "nemotron_nano_omni" | "gemma";

export type EndpointRole = "router" | "reasoner" | "device_model" | "edge_fallback";

export type FrameKind =
  | "ingest"
  | "semantic_filter"
  | "policy"
  | "routing"
  | "model_result"
  | "memory"
  | "audit";

export interface ContextFrame {
  id: string;
  kind: FrameKind;
  tier: ContextTier;
  source: string;
  createdAt: string;
  atomId?: string;
  endpointId?: EndpointId;
  summary: string;
  content: Record<string, unknown>;
  policyIds: string[];
  predecessorFrameIds: string[];
  confidence?: number;
}

export interface TierEndpoint {
  id: EndpointId;
  tier: ContextTier;
  role: EndpointRole;
  locality: "cloud" | "self_hosted" | "device" | "edge";
  supports: Array<"routing" | "rag" | "reasoning" | "long_form" | "multimodal" | "offline" | "privacy">;
  maxContextFrames: number;
}

export interface RoutingDecision {
  id: string;
  selectedEndpoint: EndpointId;
  action: RuntimeAction;
  confidence: number;
  reason: string;
  requiredFrameIds: string[];
  createdAt: string;
}

export interface ContextSyncState {
  conversationId: string;
  frames: ContextFrame[];
  lastRoutingDecision?: RoutingDecision;
  lastEndpointId?: EndpointId;
  updatedAt: string;
}

export interface ModelTurnResult {
  endpointId: EndpointId;
  action: RuntimeAction;
  confidence: number;
  output: Record<string, unknown>;
  summary: string;
  policyIds?: string[];
  createdAt: string;
}

export interface MellumContext {
  conversationId: string;
  endpoint: TierEndpoint;
  frames: ContextFrame[];
  lastRoutingDecision?: RoutingDecision;
}

export const TIER_ENDPOINTS: Record<EndpointId, TierEndpoint> = {
  mellum2: {
    id: "mellum2",
    tier: "executive",
    role: "router",
    locality: "self_hosted",
    supports: ["routing", "rag"],
    maxContextFrames: 32,
  },
  mercury2: {
    id: "mercury2",
    tier: "cortex",
    role: "reasoner",
    locality: "cloud",
    supports: ["reasoning", "long_form"],
    maxContextFrames: 64,
  },
  nemotron_nano_omni: {
    id: "nemotron_nano_omni",
    tier: "device",
    role: "device_model",
    locality: "device",
    supports: ["multimodal", "offline", "privacy"],
    maxContextFrames: 24,
  },
  gemma: {
    id: "gemma",
    tier: "edge",
    role: "edge_fallback",
    locality: "edge",
    supports: ["offline", "privacy"],
    maxContextFrames: 16,
  },
};

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function sortFrames(frames: ContextFrame[]): ContextFrame[] {
  return [...frames].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function frameId(prefix: string, seed: string, createdAt: string): string {
  return `${prefix}:${seed}:${Date.parse(createdAt)}`;
}

function endpointForFrame(endpointId: EndpointId): TierEndpoint {
  return TIER_ENDPOINTS[endpointId];
}

export function contextFrameFromAtom(atom: Atom, createdAt: string = atom.createdAt ?? new Date().toISOString()): ContextFrame {
  assertRecord(atom.payload, "atom.payload");

  return {
    id: frameId("frame", atom.id, createdAt),
    kind: "ingest",
    tier: "listener",
    source: atom.source,
    createdAt,
    atomId: atom.id,
    summary: `${atom.source}:${atom.type}`,
    content: {
      type: atom.type,
      payload: atom.payload,
    },
    policyIds: atom.policyIds ?? [],
    predecessorFrameIds: [],
  };
}

export function assertContextComplete(state: ContextSyncState): void {
  if (!state.conversationId || !state.updatedAt || !Array.isArray(state.frames)) {
    throw new Error("ContextSyncState is incomplete");
  }

  const frameIds = new Set<string>();
  for (const frame of state.frames) {
    if (
      !frame.id ||
      !frame.kind ||
      !frame.tier ||
      !frame.source ||
      !frame.createdAt ||
      !frame.summary ||
      !Array.isArray(frame.policyIds) ||
      !Array.isArray(frame.predecessorFrameIds)
    ) {
      throw new Error(`ContextFrame '${frame.id || "unknown"}' is incomplete`);
    }
    assertRecord(frame.content, `ContextFrame '${frame.id}'.content`);
    if (frameIds.has(frame.id)) {
      throw new Error(`Duplicate ContextFrame '${frame.id}'`);
    }
    frameIds.add(frame.id);
  }

  for (const frame of state.frames) {
    for (const predecessorFrameId of frame.predecessorFrameIds) {
      if (!frameIds.has(predecessorFrameId)) {
        throw new Error(`ContextFrame '${frame.id}' references missing predecessor '${predecessorFrameId}'`);
      }
    }
  }
}

export function assembleMellumContext(state: ContextSyncState, endpoint: TierEndpoint = TIER_ENDPOINTS.mellum2): MellumContext {
  assertContextComplete(state);

  const frames = sortFrames(state.frames).slice(-endpoint.maxContextFrames);
  return {
    conversationId: state.conversationId,
    endpoint,
    frames,
    lastRoutingDecision: state.lastRoutingDecision,
  };
}

export function routingDecisionFrame(decision: RoutingDecision): ContextFrame {
  const endpoint = endpointForFrame(decision.selectedEndpoint);
  return {
    id: frameId("routing", decision.id, decision.createdAt),
    kind: "routing",
    tier: "control_plane",
    source: "ava007",
    createdAt: decision.createdAt,
    endpointId: decision.selectedEndpoint,
    summary: decision.reason,
    content: {
      selectedEndpoint: decision.selectedEndpoint,
      endpointTier: endpoint.tier,
      action: decision.action,
      confidence: decision.confidence,
    },
    policyIds: [],
    predecessorFrameIds: decision.requiredFrameIds,
    confidence: decision.confidence,
  };
}

export function applyModelResult(state: ContextSyncState, result: ModelTurnResult): ContextSyncState {
  assertContextComplete(state);

  const endpoint = endpointForFrame(result.endpointId);
  const predecessorFrameIds = state.lastRoutingDecision?.requiredFrameIds ?? state.frames.slice(-1).map((frame) => frame.id);
  const resultFrame: ContextFrame = {
    id: frameId("model", `${result.endpointId}:${result.action}`, result.createdAt),
    kind: "model_result",
    tier: endpoint.tier,
    source: result.endpointId,
    createdAt: result.createdAt,
    endpointId: result.endpointId,
    summary: result.summary,
    content: {
      action: result.action,
      output: result.output,
    },
    policyIds: unique(result.policyIds ?? []),
    predecessorFrameIds,
    confidence: result.confidence,
  };

  const nextState: ContextSyncState = {
    ...state,
    frames: [...state.frames, resultFrame],
    lastEndpointId: result.endpointId,
    updatedAt: result.createdAt,
  };
  assertContextComplete(nextState);
  return nextState;
}
