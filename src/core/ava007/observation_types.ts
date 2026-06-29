/**
 * ObservationProposal — The structured input from the subconscious layer
 * (Rev.Ike / SubconsciousObserver) to the Agent Router.
 *
 * Rev.Ike observes the memory stream and graph patterns, then emits
 * ObservationProposals when it detects actionable patterns. The Agent
 * Router interprets these proposals and dispatches to specialized
 * sub-agents via the capability loadout.
 *
 * This type bridges:
 *   - SubconsciousObserver.routeAtom() → ObservationProposal
 *   - DynamicPromptEngine RoutingDecision → ObservationProposal
 *   - Direct API input → ObservationProposal
 */

import type { CognitiveTier } from './cognitive_state.js';

// ─── Observation Proposal ────────────────────────────────────────────

export type ObservationIntent =
  | 'sql_query'
  | 'web_search'
  | 'web_scrape'
  | 'graph_traversal'
  | 'temporal_seek'
  | 'atmospheric_render'
  | 'voice_synthesis'
  | 'file_operation'
  | 'api_call'
  | 'calculation'
  | 'a2a_delegation'
  | 'cognitive_state_update'
  | 'executive_decision'
  | 'unknown';

export type ProposalImportance = 'low' | 'medium' | 'high' | 'critical';

export interface ObservationProposal {
  /** Unique proposal ID. */
  id: string;
  /** The classified intent from Rev.Ike / CFGL routing. */
  intent: ObservationIntent;
  /** The data payload to process. May be large (triggers handoff). */
  payload: unknown;
  /** Confidence of the observation classification [0..1]. */
  confidence: number;
  /** Importance level (drives tier escalation). */
  importance: ProposalImportance;
  /** Source of the proposal (subconscious, perception, direct). */
  source: 'rev_ike' | 'perception_engine' | 'dynamic_prompt' | 'direct_api';
  /** The cognitive tier this proposal was routed to. */
  tier: CognitiveTier;
  /** Timestamp (ISO 8601). */
  createdAt: string;
  /** Optional reference to the originating atom. */
  originatingAtomId?: string;
  /** Optional reference to the cognitive state snapshot. */
  cognitiveStateId?: string;
}

// ─── Agent Task (dispatched from proposal) ───────────────────────────

export type AgentTarget =
  | 'SQL_AGENT'
  | 'WEB_SEARCH_AGENT'
  | 'WEB_SCRAPER_AGENT'
  | 'NEO4J_RETRIEVER'
  | 'TEMPORAL_ROUTER'
  | 'A2UI_RENDERER'
  | 'TTS_AGENT'
  | 'FILE_MANAGER'
  | 'REST_API_AGENT'
  | 'CALCULATOR_AGENT'
  | 'EXECUTIVE_AGENT';

export interface AgentTask {
  /** Task ID (derived from proposal ID or generated). */
  id: string;
  /** The target sub-agent. */
  target: AgentTarget;
  /** The intent being executed. */
  intent: ObservationIntent;
  /** The refined payload (may contain artifact references after handoff). */
  payload: RoutedPayload;
  /** Token budget for this task. */
  tokenBudget: number;
  /** Whether this task was routed through reflex (zero-LLM). */
  isReflexRoute: boolean;
  /** The proposal that spawned this task. */
  proposalId: string;
  /** Timestamp (ISO 8601). */
  dispatchedAt: string;
}

// ─── Routed Payload (after Task Memory handoff) ──────────────────────

export interface ArtifactReference {
  /** The artifact ID in TaskArtifactManager. */
  reference: string;
  /** A brief cognitive summary for the LLM context window. */
  summary: string;
  /** Whether the full payload has been offloaded. */
  isOffloaded: true;
  /** Size of the original payload in bytes. */
  originalSizeBytes: number;
}

export type RoutedPayload =
  | { mode: 'inline'; data: unknown }
  | { mode: 'offloaded'; artifact: ArtifactReference };

// ─── Routing Result ──────────────────────────────────────────────────

export interface RoutingResult {
  /** The dispatched task. */
  task: AgentTask;
  /** Whether a memory handoff occurred. */
  handoffOccurred: boolean;
  /** Artifact ID if handoff occurred. */
  artifactId?: string;
  /** The sub-agent execution result (if synchronous). */
  executionResult?: SubAgentExecutionResult;
  /** Total routing latency in ms. */
  routingLatencyMs: number;
}

export interface SubAgentExecutionResult {
  /** The target agent that executed. */
  agentId: string;
  /** Execution status. */
  status: 'success' | 'partial' | 'failed' | 'throttled';
  /** The result output. */
  output: unknown;
  /** Token cost consumed. */
  tokenCost: number;
  /** Execution latency in ms. */
  executionLatencyMs: number;
  /** Artifacts produced by the execution. */
  artifacts: Array<{
    id: string;
    type: string;
    location: string;
    sizeBytes: number;
  }>;
}

// ─── Intent → Target mapping (rule-based skill registry) ─────────────

export const INTENT_TARGET_MAP: Record<ObservationIntent, AgentTarget> = {
  sql_query: 'SQL_AGENT',
  web_search: 'WEB_SEARCH_AGENT',
  web_scrape: 'WEB_SCRAPER_AGENT',
  graph_traversal: 'NEO4J_RETRIEVER',
  temporal_seek: 'TEMPORAL_ROUTER',
  atmospheric_render: 'A2UI_RENDERER',
  voice_synthesis: 'TTS_AGENT',
  file_operation: 'FILE_MANAGER',
  api_call: 'REST_API_AGENT',
  calculation: 'CALCULATOR_AGENT',
  a2a_delegation: 'EXECUTIVE_AGENT',
  cognitive_state_update: 'EXECUTIVE_AGENT',
  executive_decision: 'EXECUTIVE_AGENT',
  unknown: 'EXECUTIVE_AGENT',
};

// ─── Intent classification (rule-based, zero-LLM) ───────────────────

export function classifyIntent(atom: {
  type: string;
  source: string;
  payload?: Record<string, unknown>;
}): ObservationIntent {
  const t = atom.type.toLowerCase();
  const s = atom.source.toLowerCase();

  // Direct type matches (zero-LLM, deterministic)
  if (t.includes('sql') || t === 'sql_query') return 'sql_query';
  if (t.includes('web_search') || t === 'web_search') return 'web_search';
  if (t.includes('scrape') || t === 'web_scrape') return 'web_scrape';
  if (t.includes('graph') || t.includes('neo4j') || t.includes('traversal')) return 'graph_traversal';
  if (t.includes('temporal') || t.includes('replay') || t.includes('timeline')) return 'temporal_seek';
  if (t.includes('atmosphere') || t.includes('render') || t.includes('a2ui')) return 'atmospheric_render';
  if (t.includes('tts') || t.includes('speech') || t.includes('voice')) return 'voice_synthesis';
  if (t.includes('file') || t === 'file_operation') return 'file_operation';
  if (t.includes('api') || t.includes('rest') || t.includes('http')) return 'api_call';
  if (t.includes('calc') || t.includes('math')) return 'calculation';
  if (t.includes('a2a') || t.includes('delegate')) return 'a2a_delegation';

  // Source-based inference
  if (s.includes('sql') || s.includes('database')) return 'sql_query';
  if (s.includes('web') || s.includes('search')) return 'web_search';
  if (s.includes('neo4j') || s.includes('graph')) return 'graph_traversal';
  if (s.includes('temporal') || s.includes('gsap')) return 'temporal_seek';
  if (s.includes('nfc')) return 'a2a_delegation';

  // Payload heuristics
  if (atom.payload) {
    if (atom.payload.query && atom.payload.table) return 'sql_query';
    if (atom.payload.url) return 'web_scrape';
    if (atom.payload.cypher) return 'graph_traversal';
    if (atom.payload.coordinate || atom.payload.timestamp) return 'temporal_seek';
    if (atom.payload.text && atom.payload.voice) return 'voice_synthesis';
  }

  return 'unknown';
}
