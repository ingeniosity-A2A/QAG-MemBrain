/**
 * DynamicPromptEngine — Staged prompt construction with memory offloading.
 *
 * 4-stage pipeline:
 *   Stage 1 — Perception:   ContextObserver / PerceptionEngine → raw sensor data
 *   Stage 2 — Interpretation: raw data → structured CognitiveState
 *   Stage 3 — Assembly:      CognitiveState → orchestrated prompt string
 *   Stage 4 — Routing:       prompt → tier-specific dispatch + offloading
 *
 * This is the "nervous system" of the cognitive runtime. The assembled
 * prompt is the ONLY thing that enters the HuggingFace context window,
 * keeping it pristine. All intermediate data is offloaded to artifacts.
 *
 * Token optimization:
 *   - Schema pre-fill: structured tags replace free-form descriptions (40-60 tokens saved)
 *   - CFGL rule routing: no LLM call for reflex-tier atoms (0 tokens)
 *   - Task Memory offloading: large artifacts never enter the prompt window
 */

import * as crypto from 'crypto';
import type {
  CognitiveState,
  AtmosphereState,
  AtmosphereMood,
} from './cognitive_state.js';
import { defaultCognitiveState } from './cognitive_state.js';
import type {
  CapabilityBid,
  AuctionWinner,
  SubAgentResult,
  SubAgentArtifact,
  OrchestratorConstraints,
  CapabilityManifest,
} from './capability_manifest.js';
import { DEFAULT_ORCHESTRATOR_CONSTRAINTS } from './capability_manifest.js';
import type { Atom } from './coordination_types.js';
import { MemoryStore } from '@memory/jsonl/index.js';

// ─── Stage 1: Perception ─────────────────────────────────────────────

export interface PerceptionInput {
  /** Raw sensor readings (DeviceSensorReading). */
  sensors?: Partial<CognitiveState['sensors']>;
  /** Interaction metrics (InteractionEntropy). */
  interaction?: Partial<CognitiveState['interaction']>;
  /** Emotional inference result. */
  emotion?: Partial<CognitiveState['emotion']>;
  /** Temporal rhythm data. */
  rhythm?: Partial<CognitiveState['rhythm']>;
  /** The atom that triggered this perception cycle. */
  triggeringAtom?: Atom;
}

// ─── Stage 2: Interpretation ────────────────────────────────────────

export interface InterpretedState {
  /** Merged cognitive state after perception fusion. */
  cognitiveState: CognitiveState;
  /** The triggering atom, if any. */
  atom?: Atom;
  /** Derived mood from emotion + rhythm. */
  derivedMood: AtmosphereMood;
  /** Estimated cognitive load [0..1]. */
  cognitiveLoad: number;
  /** Whether the perception cycle produced a significant state change. */
  stateChanged: boolean;
}

// ─── Stage 3: Assembly ───────────────────────────────────────────────

export interface AssembledPrompt {
  /** The final prompt string to send to the LLM. */
  prompt: string;
  /** Token estimate for the assembled prompt. */
  estimatedTokens: number;
  /** The tier this prompt targets. */
  targetTier: CognitiveState['activeTier'];
  /** Artifacts that were offloaded instead of included inline. */
  offloadedArtifacts: SubAgentArtifact[];
  /** The cognitive state snapshot used for assembly. */
  stateId: string;
}

// ─── Stage 4: Routing ────────────────────────────────────────────────

export interface RoutingDecision {
  /** The agent that will handle the dispatch. */
  agentId: string;
  /** The action to execute. */
  action: string;
  /** The assembled prompt (or subset) to pass. */
  prompt: string;
  /** Token budget for this dispatch. */
  tokenBudget: number;
  /** Whether this dispatch requires offloading of results. */
  requiresOffloading: boolean;
}

// ─── Dynamic Prompt Engine ───────────────────────────────────────────

export class DynamicPromptEngine {
  private constraints: OrchestratorConstraints;
  private currentState: CognitiveState;
  private artifactStore: Map<string, SubAgentArtifact> = new Map();
  private sessionStartMs: number;

  constructor(
    private memory: MemoryStore,
    constraints?: Partial<OrchestratorConstraints>,
  ) {
    this.constraints = { ...DEFAULT_ORCHESTRATOR_CONSTRAINTS, ...constraints };
    this.currentState = defaultCognitiveState();
    this.sessionStartMs = Date.now();
  }

  /**
   * Full 4-stage pipeline: Perception → Interpretation → Assembly → Routing
   */
  async process(input: PerceptionInput): Promise<RoutingDecision> {
    // Stage 1: Perception — merge sensor data into current state
    const interpreted = this.interpret(input);

    // Stage 2 is implicit in interpret()

    // Stage 3: Assembly — build the prompt from cognitive state
    const assembled = this.assemble(interpreted);

    // Stage 4: Routing — determine dispatch target
    const routing = this.route(assembled, interpreted);

    // Persist state transition to memory
    this.memory.append(6, 'cognitive_state_transition', {
      fromState: this.currentState.id,
      toState: interpreted.cognitiveState.id,
      trigger: input.triggeringAtom ? 'atom_received' : 'sensor_change',
      tier: interpreted.cognitiveState.activeTier,
      mood: interpreted.derivedMood,
      cognitiveLoad: interpreted.cognitiveLoad,
    });

    // Update current state
    this.currentState = interpreted.cognitiveState;

    return routing;
  }

  // ─── Stage 1+2: Interpret ──────────────────────────────────────────

  private interpret(input: PerceptionInput): InterpretedState {
    const prevState = this.currentState;
    const newState = { ...prevState };

    // Merge sensor data
    if (input.sensors) newState.sensors = { ...prevState.sensors, ...input.sensors };
    if (input.interaction) newState.interaction = { ...prevState.interaction, ...input.interaction };
    if (input.emotion) newState.emotion = { ...prevState.emotion, ...input.emotion };
    if (input.rhythm) newState.rhythm = { ...prevState.rhythm, ...input.rhythm };

    // Regenerate ID and timestamp
    newState.id = `cs_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    newState.timestamp = new Date().toISOString();

    // Derive mood from emotion + rhythm
    const derivedMood = this.deriveMood(newState);

    // Derive tier from constraints and atom
    if (input.triggeringAtom) {
      newState.structuredIntent = this.extractIntent(input.triggeringAtom);
      if (input.triggeringAtom.importance === 'critical') {
        newState.activeTier = 'cortex';
      } else if (input.triggeringAtom.confidence !== undefined && input.triggeringAtom.confidence < 0.6) {
        newState.activeTier = 'cortex';
      } else if (newState.activeTier === 'reflex' && input.triggeringAtom.type !== 'nfc_tap') {
        newState.activeTier = 'executive';
      }
    }

    // Thermal constraint check
    newState.thermallyViable = newState.sensors.thermalState === 'nominal' || newState.sensors.thermalState === 'warm';
    newState.batteryAllowsCortex = newState.sensors.batteryLevel > this.constraints.batteryDenyCortexThreshold;

    if (!newState.thermallyViable || !newState.batteryAllowsCortex) {
      newState.activeTier = newState.activeTier === 'cortex' ? 'executive' : newState.activeTier;
    }

    // Compute user momentum vector
    newState.userMomentumVector = this.computeMomentumVector(newState);

    // Update atmosphere from cognitive state
    newState.atmosphere = this.computeAtmosphere(newState, derivedMood);

    // Detect state change
    const stateChanged = prevState.id !== newState.id && (
      prevState.activeTier !== newState.activeTier ||
      prevState.atmosphere.mood !== newState.atmosphere.mood ||
      Math.abs(prevState.userMomentumVector - newState.userMomentumVector) > 0.1
    );

    // Compute cognitive load
    const cognitiveLoad = this.computeCognitiveLoad(newState);

    return {
      cognitiveState: newState,
      atom: input.triggeringAtom,
      derivedMood,
      cognitiveLoad,
      stateChanged,
    };
  }

  // ─── Stage 3: Assembly ─────────────────────────────────────────────

  private assemble(interpreted: InterpretedState): AssembledPrompt {
    const state = interpreted.cognitiveState;
    const offloaded: SubAgentArtifact[] = [];

    // Offload large context to artifacts instead of bloating prompt
    let neo4jContext = state.neo4jContextSummary;
    if (neo4jContext.length > 500) {
      const artifactId = `artifact_neo4j_${Date.now()}`;
      const artifact: SubAgentArtifact = {
        id: artifactId,
        type: 'json_blob',
        location: `memory://artifacts/${artifactId}`,
        sizeBytes: Buffer.byteLength(neo4jContext, 'utf8'),
        offloaded: true,
      };
      this.artifactStore.set(artifactId, artifact);
      offloaded.push(artifact);
      neo4jContext = `[Neo4j context offloaded to ${artifactId}]`;
    }

    // Schema pre-fill: structured tags replace free-form descriptions
    // This saves 40-60 tokens per prompt by eliminating descriptive filler
    const prompt = `<SYSTEM_ROLE>Ava007 A2A-OA Cognitive Runtime v0.7</SYSTEM_ROLE>
<ATMOSPHERE>${JSON.stringify(state.atmosphere)}</ATMOSPHERE>
<USER_MOMENTUM>${state.userMomentumVector.toFixed(2)}</USER_MOMENTUM>
<INTENT>${state.structuredIntent}</INTENT>
<MEMORY_VECTOR>${neo4jContext}</MEMORY_VECTOR>
<ACTIVE_AGENTS>${state.activeAgentStatus}</ACTIVE_AGENTS>
<CONSTRAINTS>local-first, thermal-aware, graceful degradation</CONSTRAINTS>
<TIER>${state.activeTier}</TIER>
<THERMAL>${state.sensors.thermalState}</THERMAL>
<BATTERY>${state.sensors.batteryLevel}%</BATTERY>`.trim();

    // Rough token estimate: ~4 chars per token for English
    const estimatedTokens = Math.ceil(prompt.length / 4);

    return {
      prompt,
      estimatedTokens,
      targetTier: state.activeTier,
      offloadedArtifacts: offloaded,
      stateId: state.id,
    };
  }

  // ─── Stage 4: Routing ──────────────────────────────────────────────

  private route(assembled: AssembledPrompt, interpreted: InterpretedState): RoutingDecision {
    const tier = assembled.targetTier;
    const tokenBudget = tier === 'reflex'
      ? 100
      : tier === 'executive'
        ? this.constraints.globalTokenBudget * 0.5
        : this.constraints.globalTokenBudget;

    // Map tier to default agent
    const agentId = tier === 'reflex'
      ? 'griptape_calculator'  // Reflex: zero-LLM, immediate
      : tier === 'executive'
        ? 'griptape_web_search'  // Executive: Mellum2 + retrieval
        : 'griptape_web_scraper';  // Cortex: Mercury 2 + deep retrieval

    const action = interpreted.atom
      ? this.mapAtomToAction(interpreted.atom)
      : 'cognitive_state_update';

    return {
      agentId,
      action,
      prompt: assembled.prompt,
      tokenBudget: Math.floor(tokenBudget),
      requiresOffloading: assembled.estimatedTokens > this.constraints.globalTokenBudget * 0.7,
    };
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  private deriveMood(state: CognitiveState): AtmosphereMood {
    const { valence, arousal } = state.emotion;
    if (arousal === 'high' && valence < 0) return 'urgent';
    if (arousal === 'high' && valence > 0) return 'creative';
    if (valence > 0 && arousal !== 'high') return 'focused';
    if (valence < 0 && arousal === 'low') return 'reflective';
    if (state.rhythm.sessionMomentum < 0.3) return 'calm';
    return 'focused';
  }

  private computeMomentumVector(state: CognitiveState): number {
    const interactionWeight = Math.min(state.interaction.interactionRate / 60, 1) * 0.3;
    const dwellWeight = Math.min(state.interaction.dwellTimeMs / 30000, 1) * 0.2;
    const emotionWeight = (state.emotion.valence as number) * 0.3;
    const sessionWeight = (state.rhythm.sessionMomentum - 0.5) * 0.2;
    return Math.max(-1, Math.min(1, interactionWeight + dwellWeight + emotionWeight + sessionWeight));
  }

  private computeAtmosphere(state: CognitiveState, mood: AtmosphereMood): AtmosphereState {
    const moodVisuals: Record<AtmosphereMood, Partial<CognitiveState['atmosphere']['visuals']>> = {
      calm: { blur: 0.1, particleDensity: 0.2, lighting: 0.6, motionVelocity: 0.3 },
      focused: { blur: 0, particleDensity: 0.1, lighting: 0.8, motionVelocity: 0.5 },
      alert: { blur: 0, particleDensity: 0.5, lighting: 0.9, motionVelocity: 0.8 },
      creative: { blur: 0.05, particleDensity: 0.6, lighting: 0.7, motionVelocity: 0.7 },
      reflective: { blur: 0.15, particleDensity: 0.3, lighting: 0.5, motionVelocity: 0.2 },
      urgent: { blur: 0, particleDensity: 0.8, lighting: 1, motionVelocity: 1 },
    };

    const visualOverrides = moodVisuals[mood] ?? {};
    const thermal = state.sensors.thermalState;

    return {
      visuals: {
        ...state.atmosphere.visuals,
        ...visualOverrides,
        // Thermal throttling: reduce motion and particles when hot
        motionVelocity: thermal === 'hot' || thermal === 'critical'
          ? Math.min((visualOverrides.motionVelocity ?? state.atmosphere.visuals.motionVelocity) * 0.5, 0.3)
          : visualOverrides.motionVelocity ?? state.atmosphere.visuals.motionVelocity,
        particleDensity: thermal === 'hot' || thermal === 'critical'
          ? Math.min((visualOverrides.particleDensity ?? state.atmosphere.visuals.particleDensity) * 0.5, 0.2)
          : visualOverrides.particleDensity ?? state.atmosphere.visuals.particleDensity,
      },
      audio: {
        ...state.atmosphere.audio,
        cavernVelocity: mood === 'urgent' ? 0.8 : mood === 'calm' ? 0.2 : 0.4,
        ambientIntensity: mood === 'urgent' ? 0.5 : mood === 'calm' ? 0.1 : 0.3,
      },
      mood,
      updatedAt: new Date().toISOString(),
    };
  }

  private computeCognitiveLoad(state: CognitiveState): number {
    const tierWeight = state.activeTier === 'cortex' ? 1 : state.activeTier === 'executive' ? 0.6 : 0.2;
    const thermalWeight = state.sensors.thermalState === 'critical' ? 0.9 : state.sensors.thermalState === 'hot' ? 0.7 : 0;
    const tokenWeight = Math.max(0, 1 - state.tokenBudgetRemaining / 4096) * 0.3;
    return Math.min(1, tierWeight * 0.4 + thermalWeight * 0.3 + tokenWeight);
  }

  private extractIntent(atom: Atom): string {
    if (typeof atom.payload.description === 'string') return atom.payload.description;
    if (typeof atom.payload.intent === 'string') return atom.payload.intent;
    return `${atom.type} from ${atom.source}`;
  }

  private mapAtomToAction(atom: Atom): string {
    const actionMap: Record<string, string> = {
      nfc_tap: 'resolve_nfc_tap',
      webhook: 'resolve_webhook',
      a2a_task: 'resolve_a2a_task',
      document: 'process_document',
      lora_telemetry: 'process_telemetry',
      sensor: 'process_sensor',
    };
    return actionMap[atom.type] ?? 'executive_action';
  }

  // ─── Public API ─────────────────────────────────────────────────────

  get state(): Readonly<CognitiveState> {
    return this.currentState;
  }

  get artifacts(): ReadonlyMap<string, SubAgentArtifact> {
    return this.artifactStore;
  }

  /**
   * Retrieve an offloaded artifact by ID.
   * In production, this would fetch from Task Memory (file/Neo4j/vector store).
   */
  getArtifact(id: string): SubAgentArtifact | undefined {
    return this.artifactStore.get(id);
  }

  /**
   * Update agent status string from orchestrator results.
   */
  updateAgentStatus(status: string): void {
    this.currentState.activeAgentStatus = status;
  }

  /**
   * Update Neo4j context summary.
   * If the summary exceeds 500 chars, it will be offloaded on next assembly.
   */
  updateNeo4jContext(summary: string): void {
    this.currentState.neo4jContextSummary = summary;
  }
}
