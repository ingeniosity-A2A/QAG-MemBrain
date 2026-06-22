/**
 * AgentRouter — Executive switchboard for the A2A-OA.
 *
 * Sits between the high-level cognitive decisions of the brain and
 * the specialized execution capabilities. Interprets ObservationProposals
 * from Rev.Ike (SubconsciousObserver) and delegates tasks while ensuring
 * that massive data payloads are offloaded into Task Memory rather than
 * bloating the prompt context.
 *
 * Routing Pipeline:
 *   1. Input Reception: ObservationProposal from Rev.Ike or DynamicPromptEngine
 *   2. Capability Matching: Intent → Target Agent via rule-based skill registry
 *   3. Memory Threshold Check: Payload size analysis → Task Memory Handoff
 *   4. Agent Dispatch: Execute via appropriate Griptape Driver
 *
 * Latency target: <5ms for non-semantic (reflex) routing.
 */

import * as crypto from 'crypto';
import type { CapabilityManifest, OrchestratorConstraints } from './capability_manifest.js';
import { DEFAULT_ORCHESTRATOR_CONSTRAINTS, GRIPTAPE_TOOL_MANIFESTS } from './capability_manifest.js';
import type { CognitiveTier } from './cognitive_state.js';
import type {
  ObservationProposal,
  ObservationIntent,
  AgentTarget,
  AgentTask,
  RoutedPayload,
  RoutingResult,
  SubAgentExecutionResult,
} from './observation_types.js';
import { INTENT_TARGET_MAP, classifyIntent } from './observation_types.js';
import type { TaskArtifactManager, ArtifactKind } from './task_artifact_manager.js';
import { MemoryStore } from '@memory/jsonl/index.js';
import type { Atom } from './coordination_types.js';

// ─── Agent Execution Interface ───────────────────────────────────────

export interface AgentExecutor {
  /** The target agent this executor handles. */
  target: AgentTarget;
  /** Execute a task with the given payload. */
  execute(task: AgentTask): Promise<SubAgentExecutionResult>;
}

// ─── Deterministic (stub) executors for development ──────────────────

class DeterministicSqlExecutor implements AgentExecutor {
  target: AgentTarget = 'SQL_AGENT';
  async execute(task: AgentTask): Promise<SubAgentExecutionResult> {
    return {
      agentId: 'griptape_sql_client',
      status: 'success',
      output: { rows: [], affectedRows: 0, query: 'SELECT (stub)' },
      tokenCost: 0,
      executionLatencyMs: 10,
      artifacts: [],
    };
  }
}

class DeterministicWebSearchExecutor implements AgentExecutor {
  target: AgentTarget = 'WEB_SEARCH_AGENT';
  async execute(task: AgentTask): Promise<SubAgentExecutionResult> {
    return {
      agentId: 'griptape_web_search',
      status: 'success',
      output: { results: [], query: '(stub search)' },
      tokenCost: 200,
      executionLatencyMs: 500,
      artifacts: [],
    };
  }
}

class DeterministicWebScraperExecutor implements AgentExecutor {
  target: AgentTarget = 'WEB_SCRAPER_AGENT';
  async execute(task: AgentTask): Promise<SubAgentExecutionResult> {
    const payloadSize = task.payload.mode === 'offloaded'
      ? task.payload.artifact.originalSizeBytes
      : Buffer.byteLength(JSON.stringify(task.payload), 'utf8');

    return {
      agentId: 'griptape_web_scraper',
      status: 'success',
      output: { content: '[Scraped content stub]', url: '' },
      tokenCost: 500,
      executionLatencyMs: 2000,
      artifacts: payloadSize > 4096 ? [{
        id: `scrape_artifact_${Date.now()}`,
        type: 'scraped_content',
        location: 'memory://artifacts/scrape_stub',
        sizeBytes: payloadSize,
      }] : [],
    };
  }
}

class DeterministicNeo4jExecutor implements AgentExecutor {
  target: AgentTarget = 'NEO4J_RETRIEVER';
  async execute(task: AgentTask): Promise<SubAgentExecutionResult> {
    return {
      agentId: 'griptape_neo4j_driver',
      status: 'success',
      output: { nodes: [], relationships: [], depth: 5 },
      tokenCost: 0,
      executionLatencyMs: 50,
      artifacts: [],
    };
  }
}

class DeterministicTemporalExecutor implements AgentExecutor {
  target: AgentTarget = 'TEMPORAL_ROUTER';
  async execute(task: AgentTask): Promise<SubAgentExecutionResult> {
    // Zero-LLM Cost: Direct seek in Context Lake via LiteNotebookLM
    return {
      agentId: 'lite_notebook_lm',
      status: 'success',
      output: { coordinates: [], label: 'temporal_seek_stub' },
      tokenCost: 0,
      executionLatencyMs: 2,
      artifacts: [],
    };
  }
}

class DeterministicA2UIExecutor implements AgentExecutor {
  target: AgentTarget = 'A2UI_RENDERER';
  async execute(task: AgentTask): Promise<SubAgentExecutionResult> {
    return {
      agentId: 'a2ui_surface_compiler',
      status: 'success',
      output: { mutations: [], gsapCoordinates: [] },
      tokenCost: 0,
      executionLatencyMs: 5,
      artifacts: [],
    };
  }
}

class DeterministicTTSExecutor implements AgentExecutor {
  target: AgentTarget = 'TTS_AGENT';
  async execute(task: AgentTask): Promise<SubAgentExecutionResult> {
    return {
      agentId: 'griptape_text_to_speech',
      status: 'success',
      output: { audioBuffer: '(stub)', durationSec: 2.5 },
      tokenCost: 100,
      executionLatencyMs: 1000,
      artifacts: [{
        id: `tts_artifact_${Date.now()}`,
        type: 'audio_buffer',
        location: 'memory://artifacts/tts_stub',
        sizeBytes: 48000,
      }],
    };
  }
}

class DeterministicExecutiveExecutor implements AgentExecutor {
  target: AgentTarget = 'EXECUTIVE_AGENT';
  async execute(task: AgentTask): Promise<SubAgentExecutionResult> {
    return {
      agentId: 'ava007_executive',
      status: 'success',
      output: { decision: 'executive_action', reason: 'Deterministic stub' },
      tokenCost: 500,
      executionLatencyMs: 100,
      artifacts: [],
    };
  }
}

// ─── Capability Manifest → Executor Registry ────────────────────────

const DETERMINISTIC_EXECUTORS: AgentExecutor[] = [
  new DeterministicSqlExecutor(),
  new DeterministicWebSearchExecutor(),
  new DeterministicWebScraperExecutor(),
  new DeterministicNeo4jExecutor(),
  new DeterministicTemporalExecutor(),
  new DeterministicA2UIExecutor(),
  new DeterministicTTSExecutor(),
  new DeterministicExecutiveExecutor(),
];

// ─── Intent → ArtifactKind mapping ───────────────────────────────────

function intentToArtifactKind(intent: ObservationIntent): ArtifactKind {
  const map: Record<ObservationIntent, ArtifactKind> = {
    sql_query: 'sql_result_set',
    web_search: 'json_blob',
    web_scrape: 'scraped_content',
    graph_traversal: 'neo4j_traversal',
    temporal_seek: 'temporal_coordinates',
    atmospheric_render: 'atmosphere_snapshot',
    voice_synthesis: 'audio_buffer',
    file_operation: 'file_content',
    api_call: 'json_blob',
    calculation: 'json_blob',
    a2a_delegation: 'json_blob',
    cognitive_state_update: 'json_blob',
    executive_decision: 'json_blob',
    unknown: 'json_blob',
  };
  return map[intent];
}

// ─── AgentRouter ─────────────────────────────────────────────────────

export class AgentRouter {
  private executors: Map<AgentTarget, AgentExecutor>;
  private constraints: OrchestratorConstraints;
  private activeTaskCount: number = 0;

  constructor(
    private memory: MemoryStore,
    private artifactManager: TaskArtifactManager,
    constraints?: Partial<OrchestratorConstraints>,
    customExecutors?: AgentExecutor[],
  ) {
    this.constraints = { ...DEFAULT_ORCHESTRATOR_CONSTRAINTS, ...constraints };
    this.executors = new Map();

    // Register executors (custom take priority over defaults)
    const allExecutors = customExecutors
      ? [...DETERMINISTIC_EXECUTORS, ...customExecutors]
      : DETERMINISTIC_EXECUTORS;

    for (const executor of allExecutors) {
      this.executors.set(executor.target, executor);
    }
  }

  /**
   * Route an ObservationProposal through the full pipeline:
   *   1. Capability Matching
   *   2. Memory Threshold Check + Handoff
   *   3. Agent Dispatch
   */
  async route(proposal: ObservationProposal): Promise<RoutingResult> {
    const startMs = Date.now();

    // 1. Determine Target Agent based on rule-based Skill Registry
    const targetAgent = this.identifyTargetAgent(proposal.intent);

    // 2. Perform Task Memory Handoff if payload is heavy
    const refinedPayload = await this.handleMemoryHandoff(
      proposal.payload,
      proposal.intent,
      proposal.id,
    );

    // 3. Build the AgentTask
    const task: AgentTask = {
      id: `task_${proposal.id}`,
      target: targetAgent,
      intent: proposal.intent,
      payload: refinedPayload.payload,
      tokenBudget: this.computeTokenBudget(proposal.tier),
      isReflexRoute: proposal.tier === 'reflex',
      proposalId: proposal.id,
      dispatchedAt: new Date().toISOString(),
    };

    // 4. Dispatch to Specialized Toolkits
    let executionResult: SubAgentExecutionResult | undefined;
    const executor = this.executors.get(targetAgent);
    if (executor) {
      // Concurrency check
      if (this.activeTaskCount >= this.constraints.maxConcurrentAgents) {
        executionResult = {
          agentId: executor.target,
          status: 'throttled',
          output: null,
          tokenCost: 0,
          executionLatencyMs: Date.now() - startMs,
          artifacts: [],
        };
      } else {
        // Constraint checks
        const manifest = GRIPTAPE_TOOL_MANIFESTS.find(m => m.agentId === executor.target);
        if (manifest) {
          if (manifest.requiresNetwork && !this.constraints.networkAllowed) {
            executionResult = {
              agentId: manifest.agentId,
              status: 'throttled',
              output: null,
              tokenCost: 0,
              executionLatencyMs: Date.now() - startMs,
              artifacts: [],
            };
          } else if (manifest.minimumTier === 'cortex' && !this.constraints.cortexAllowed) {
            executionResult = {
              agentId: manifest.agentId,
              status: 'throttled',
              output: null,
              tokenCost: 0,
              executionLatencyMs: Date.now() - startMs,
              artifacts: [],
            };
          }
        }

        if (!executionResult) {
          this.activeTaskCount++;
          try {
            executionResult = await executor.execute(task);
          } catch (err) {
            executionResult = {
              agentId: executor.target,
              status: 'failed',
              output: null,
              tokenCost: 0,
              executionLatencyMs: Date.now() - startMs,
              artifacts: [],
            };
          } finally {
            this.activeTaskCount--;
          }
        }
      }
    }

    // Audit the routing decision
    this.memory.append(6, 'agent_router_dispatch', {
      proposalId: proposal.id,
      intent: proposal.intent,
      targetAgent,
      tier: proposal.tier,
      handoffOccurred: refinedPayload.handoffOccurred,
      artifactId: refinedPayload.artifactId,
      executionStatus: executionResult?.status,
      routingLatencyMs: Date.now() - startMs,
    });

    return {
      task,
      handoffOccurred: refinedPayload.handoffOccurred,
      artifactId: refinedPayload.artifactId,
      executionResult,
      routingLatencyMs: Date.now() - startMs,
    };
  }

  /**
   * Convenience: route an Atom directly (creates ObservationProposal internally).
   */
  async routeAtom(atom: Atom, source?: ObservationProposal['source']): Promise<RoutingResult> {
    const intent = classifyIntent(atom);
    const proposal: ObservationProposal = {
      id: `prop_${atom.id}_${Date.now()}`,
      intent,
      payload: atom.payload,
      confidence: atom.confidence ?? 0.5,
      importance: (atom.importance ?? 'medium') as ObservationProposal['importance'],
      source: source ?? 'rev_ike',
      tier: this.inferTier(atom),
      createdAt: new Date().toISOString(),
      originatingAtomId: atom.id,
    };
    return this.route(proposal);
  }

  // ─── Capability Matching ────────────────────────────────────────────

  private identifyTargetAgent(intent: ObservationIntent): AgentTarget {
    return INTENT_TARGET_MAP[intent] ?? 'EXECUTIVE_AGENT';
  }

  // ─── Memory Threshold Check & Handoff ───────────────────────────────

  private async handleMemoryHandoff(
    payload: unknown,
    intent: ObservationIntent,
    proposalId: string,
  ): Promise<{ payload: RoutedPayload; handoffOccurred: boolean; artifactId?: string }> {
    // Check if payload exceeds inline threshold
    if (!this.artifactManager.isPayloadTooLarge(payload)) {
      return {
        payload: { mode: 'inline', data: payload },
        handoffOccurred: false,
      };
    }

    // Offload to Task Memory
    const kind = intentToArtifactKind(intent);
    const handoffResult = await this.artifactManager.handoff({
      payload,
      kind,
      taskId: proposalId,
    });

    return {
      payload: {
        mode: 'offloaded',
        artifact: {
          reference: handoffResult.reference,
          summary: handoffResult.summary,
          isOffloaded: true,
          originalSizeBytes: handoffResult.originalSizeBytes,
        },
      },
      handoffOccurred: true,
      artifactId: handoffResult.reference,
    };
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  private computeTokenBudget(tier: CognitiveTier): number {
    switch (tier) {
      case 'reflex': return this.constraints.globalTokenBudget * 0.05;
      case 'executive': return this.constraints.globalTokenBudget * 0.4;
      case 'cortex': return this.constraints.globalTokenBudget;
    }
  }

  private inferTier(atom: Atom): CognitiveTier {
    if (atom.importance === 'critical') return 'cortex';
    if (atom.confidence !== undefined && atom.confidence < 0.5) return 'cortex';
    if (atom.type === 'nfc_tap' || atom.source === 'nfc') return 'reflex';
    if (atom.type === 'webhook' && (atom.confidence ?? 0) > 0.85) return 'reflex';
    return 'executive';
  }

  // ─── Public API ─────────────────────────────────────────────────────

  get activeConcurrency(): number {
    return this.activeTaskCount;
  }

  /**
   * Register a custom executor for a target agent.
   * Overrides the default deterministic executor.
   */
  registerExecutor(executor: AgentExecutor): void {
    this.executors.set(executor.target, executor);
  }

  /**
   * Update runtime constraints (e.g., when thermal state changes).
   */
  updateConstraints(updates: Partial<OrchestratorConstraints>): void {
    this.constraints = { ...this.constraints, ...updates };
  }

  /**
   * Get the current capability manifest summary.
   */
  getCapabilityStatus(): Array<{ agentId: string; target: AgentTarget; healthy: boolean; load: number }> {
    const results: Array<{ agentId: string; target: AgentTarget; healthy: boolean; load: number }> = [];
    for (const [target, executor] of this.executors) {
      const manifest = GRIPTAPE_TOOL_MANIFESTS.find(m => m.agentId === executor.target);
      results.push({
        agentId: manifest?.agentId ?? executor.target,
        target,
        healthy: manifest?.health === 'healthy',
        load: manifest?.currentLoad ?? 0,
      });
    }
    return results;
  }
}
