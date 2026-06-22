/**
 * Capability Manifest & Sub-Agent Contract
 * for the AgentOrchestrator capability auction / bidding system.
 *
 * Each sub-agent (renderer, scraper, TTS, SQL, etc.) declares a
 * CapabilityManifest. The AgentOrchestrator runs a sealed-bid auction
 * to select the best agent for each task, preventing local pipeline
 * overload and ensuring graceful degradation.
 *
 * Design mirrors Griptape Tools mapped in ava_007_runtime.py:
 *   Calculator, DateTime, FileManager, SqlClient, RestApi,
 *   WebSearch, WebScraper, TextToSpeech
 */

import type { CognitiveTier } from './cognitive_state.js';

// ─── Capability Manifest ─────────────────────────────────────────────

export type CapabilityCategory =
  | 'computation'    // Calculator, DateTime
  | 'storage'        // FileManager, SqlClient
  | 'retrieval'      // WebSearch, WebScraper, Neo4j traversal
  | 'communication'  // RestApi, A2A protocol
  | 'rendering'      // A2UI SurfaceCompiler, GSAP
  | 'synthesis'      // TextToSpeech, Mercury2, Mellum2
  | 'perception';    // ContextObserver, sensors

export interface CapabilityManifest {
  /** Unique agent identifier (e.g., 'griptape_web_scraper'). */
  agentId: string;
  /** Human-readable name. */
  displayName: string;
  /** Category this agent belongs to. */
  category: CapabilityCategory;
  /** List of action types this agent can handle. */
  supportedActions: string[];
  /** Minimum tier required to invoke this agent. */
  minimumTier: CognitiveTier;
  /** Estimated token cost per invocation (0 for zero-LLM agents). */
  estimatedTokenCost: number;
  /** Estimated latency in ms. */
  estimatedLatencyMs: number;
  /** Whether this agent requires network access. */
  requiresNetwork: boolean;
  /** Whether this agent requires local GPU/NPU. */
  requiresLocalInference: boolean;
  /** Maximum concurrent invocations before queuing. */
  maxConcurrency: number;
  /** Current load [0..1]. Updated at runtime by the orchestrator. */
  currentLoad: number;
  /** Agent health status. */
  health: 'healthy' | 'degraded' | 'unavailable';
}

// ─── Bid (sealed-bid auction entry) ─────────────────────────────────

export interface CapabilityBid {
  /** The agent submitting the bid. */
  agentId: string;
  /** The action being bid on. */
  action: string;
  /** Confidence this agent can fulfill the action [0..1]. */
  confidence: number;
  /** Estimated token cost for this specific invocation. */
  estimatedTokenCost: number;
  /** Estimated latency for this specific invocation (ms). */
  estimatedLatencyMs: number;
  /** Priority modifier (higher = preferred). Default 0. */
  priorityModifier: number;
  /** Whether the agent can handle the task under current constraints. */
  viable: boolean;
  /** Reason if not viable. */
  notViableReason?: string;
}

// ─── Auction Result ──────────────────────────────────────────────────

export interface AuctionWinner {
  /** The winning agent ID. */
  agentId: string;
  /** The action being dispatched. */
  action: string;
  /** Winning bid details. */
  bid: CapabilityBid;
  /** Score that won the auction. */
  score: number;
  /** All bids received (for audit). */
  allBids: CapabilityBid[];
  /** Timestamp (ISO 8601). */
  timestamp: string;
}

// ─── Sub-Agent Result ────────────────────────────────────────────────

export type SubAgentResultStatus = 'success' | 'partial' | 'failed' | 'timeout' | 'throttled';

export interface SubAgentResult {
  /** The agent that produced this result. */
  agentId: string;
  /** The action that was dispatched. */
  action: string;
  /** Execution status. */
  status: SubAgentResultStatus;
  /** Output payload. Structure depends on the agent category. */
  output: unknown;
  /** Actual token cost consumed. */
  tokenCost: number;
  /** Actual latency in ms. */
  latencyMs: number;
  /** Error message if status !== 'success'. */
  error?: string;
  /** Artifacts produced (for Task Memory offloading). */
  artifacts: SubAgentArtifact[];
  /** Timestamp (ISO 8601). */
  timestamp: string;
}

export interface SubAgentArtifact {
  /** Artifact ID. */
  id: string;
  /** Artifact type (file, neo4j_node, vector_entry, json_blob). */
  type: 'file' | 'neo4j_node' | 'vector_entry' | 'json_blob';
  /** Storage location (file path, Neo4j node ID, etc.). */
  location: string;
  /** Size in bytes. */
  sizeBytes: number;
  /** Whether this artifact has been offloaded to Task Memory. */
  offloaded: boolean;
}

// ─── Orchestrator Constraints ────────────────────────────────────────

export interface OrchestratorConstraints {
  /** Maximum total token budget for concurrent agent invocations. */
  globalTokenBudget: number;
  /** Maximum concurrent agent invocations. */
  maxConcurrentAgents: number;
  /** Whether cortex-tier agents are allowed (thermal/battery gate). */
  cortexAllowed: boolean;
  /** Whether network-dependent agents are allowed. */
  networkAllowed: boolean;
  /** Thermal threshold: above this, throttle all local-inference agents. */
  thermalThrottleThreshold: number;
  /** Battery threshold: below this, deny cortex-tier agents. */
  batteryDenyCortexThreshold: number;
}

export const DEFAULT_ORCHESTRATOR_CONSTRAINTS: OrchestratorConstraints = {
  globalTokenBudget: 4096,
  maxConcurrentAgents: 5,
  cortexAllowed: true,
  networkAllowed: true,
  thermalThrottleThreshold: 0.8,
  batteryDenyCortexThreshold: 20,
};

// ─── Griptape Tool Manifests (canonical declarations) ────────────────

export const GRIPTAPE_TOOL_MANIFESTS: CapabilityManifest[] = [
  {
    agentId: 'griptape_calculator',
    displayName: 'Calculator',
    category: 'computation',
    supportedActions: ['calculate', 'math_operation'],
    minimumTier: 'reflex',
    estimatedTokenCost: 0,
    estimatedLatencyMs: 5,
    requiresNetwork: false,
    requiresLocalInference: false,
    maxConcurrency: 10,
    currentLoad: 0,
    health: 'healthy',
  },
  {
    agentId: 'griptape_datetime',
    displayName: 'DateTime',
    category: 'computation',
    supportedActions: ['get_datetime', 'time_operation'],
    minimumTier: 'reflex',
    estimatedTokenCost: 0,
    estimatedLatencyMs: 2,
    requiresNetwork: false,
    requiresLocalInference: false,
    maxConcurrency: 10,
    currentLoad: 0,
    health: 'healthy',
  },
  {
    agentId: 'griptape_file_manager',
    displayName: 'FileManager',
    category: 'storage',
    supportedActions: ['read_file', 'write_file', 'list_files', 'delete_file'],
    minimumTier: 'reflex',
    estimatedTokenCost: 0,
    estimatedLatencyMs: 50,
    requiresNetwork: false,
    requiresLocalInference: false,
    maxConcurrency: 3,
    currentLoad: 0,
    health: 'healthy',
  },
  {
    agentId: 'griptape_sql_client',
    displayName: 'SqlClient',
    category: 'storage',
    supportedActions: ['sql_query', 'sql_execute'],
    minimumTier: 'executive',
    estimatedTokenCost: 0,
    estimatedLatencyMs: 100,
    requiresNetwork: false,
    requiresLocalInference: false,
    maxConcurrency: 2,
    currentLoad: 0,
    health: 'healthy',
  },
  {
    agentId: 'griptape_rest_api',
    displayName: 'RestApi',
    category: 'communication',
    supportedActions: ['api_get', 'api_post', 'api_put', 'api_delete'],
    minimumTier: 'executive',
    estimatedTokenCost: 0,
    estimatedLatencyMs: 500,
    requiresNetwork: true,
    requiresLocalInference: false,
    maxConcurrency: 3,
    currentLoad: 0,
    health: 'healthy',
  },
  {
    agentId: 'griptape_web_search',
    displayName: 'WebSearch',
    category: 'retrieval',
    supportedActions: ['web_search'],
    minimumTier: 'executive',
    estimatedTokenCost: 200,
    estimatedLatencyMs: 2000,
    requiresNetwork: true,
    requiresLocalInference: false,
    maxConcurrency: 2,
    currentLoad: 0,
    health: 'healthy',
  },
  {
    agentId: 'griptape_web_scraper',
    displayName: 'WebScraper',
    category: 'retrieval',
    supportedActions: ['scrape_page', 'extract_content'],
    minimumTier: 'executive',
    estimatedTokenCost: 500,
    estimatedLatencyMs: 5000,
    requiresNetwork: true,
    requiresLocalInference: false,
    maxConcurrency: 1,
    currentLoad: 0,
    health: 'healthy',
  },
  {
    agentId: 'griptape_text_to_speech',
    displayName: 'TextToSpeech',
    category: 'synthesis',
    supportedActions: ['synthesize_speech'],
    minimumTier: 'executive',
    estimatedTokenCost: 100,
    estimatedLatencyMs: 3000,
    requiresNetwork: false,
    requiresLocalInference: true,
    maxConcurrency: 1,
    currentLoad: 0,
    health: 'healthy',
  },
];
