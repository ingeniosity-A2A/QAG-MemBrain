/**
 * CognitiveState & AtmosphereState — Formal type interfaces
 * for the Ava007 A2A-OA cognitive runtime.
 *
 * These types define the shared contract between:
 *   - AtmosphereProvider (root wrapper)
 *   - PerceptionEngine (ContextObserver)
 *   - A2UIRenderer (SurfaceCompiler)
 *   - DynamicPromptEngine (prompt assembly)
 *   - AgentOrchestrator (capability bidding)
 *
 * All consumers read from a single CognitiveState snapshot;
 * mutation flows through the coordination loop.
 */

// ─── Atmosphere State ────────────────────────────────────────────────

export interface AtmosphereVisuals {
  /** Gaussian blur intensity [0..1]. 0 = sharp, 1 = deep fog. */
  blur: number;
  /** Particle density [0..1]. Drives ambient particle count. */
  particleDensity: number;
  /** Scene lighting intensity [0..1]. */
  lighting: number;
  /** Color temperature in Kelvin (2000=warm, 6500=daylight, 10000=cool). */
  colorTemperature: number;
  /** Motion velocity scalar [0..2]. Affects GSAP tween speed. */
  motionVelocity: number;
  /** Depth-of-field focal distance [0..1]. */
  focalDepth: number;
}

export interface AtmosphereAudio {
  /** CavernBridge velocity [0..1]. Drives spatial audio rendering. */
  cavernVelocity: number;
  /** MPEG-H rendering mode. */
  renderingMode: 'binaural' | 'stereo' | 'spatial';
  /** Ambient soundscape intensity [0..1]. */
  ambientIntensity: number;
}

export type AtmosphereMood =
  | 'calm'
  | 'focused'
  | 'alert'
  | 'creative'
  | 'reflective'
  | 'urgent';

export interface AtmosphereState {
  /** Visual parameters consumed by A2UI SurfaceCompiler. */
  visuals: AtmosphereVisuals;
  /** Audio parameters consumed by CavernBridge. */
  audio: AtmosphereAudio;
  /** Semantic mood label derived from cognitive state. */
  mood: AtmosphereMood;
  /** Timestamp of last atmosphere update (ISO 8601). */
  updatedAt: string;
}

// ─── Perception (ContextObserver / PerceptionEngine) ─────────────────

export interface DeviceSensorReading {
  /** Accelerometer magnitude (m/s^2). */
  acceleration: number;
  /** Ambient light level (lux). */
  lightLevel: number;
  /** Battery percentage [0..100]. */
  batteryLevel: number;
  /** Thermal state: nominal / warm / hot / critical. */
  thermalState: 'nominal' | 'warm' | 'hot' | 'critical';
  /** Network connectivity type. */
  networkType: 'wifi' | 'cellular' | 'offline' | 'unknown';
  /** Screen form factor. */
  formFactor: 'phone' | 'tablet' | 'foldable' | 'desktop' | 'dex';
}

export interface InteractionEntropy {
  /** Keystroke / tap events per minute. */
  interactionRate: number;
  /** Dwell time on current surface (ms). */
  dwellTimeMs: number;
  /** Scroll velocity (px/s). Positive = down. */
  scrollVelocity: number;
  /** Session duration in seconds. */
  sessionDurationSec: number;
}

export type EmotionalValence = -1 | -0.5 | 0 | 0.5 | 1;
export type EmotionalArousal = 'low' | 'medium' | 'high';

export interface EmotionalInference {
  /** Valence: -1 (negative) to +1 (positive). */
  valence: EmotionalValence;
  /** Arousal intensity. */
  arousal: EmotionalArousal;
  /** Confidence of inference [0..1]. */
  confidence: number;
  /** Source of inference. */
  source: 'local_model' | 'rule_based' | 'explicit_feedback';
}

export interface TemporalRhythm {
  /** Circadian phase: morning/afternoon/evening/night. */
  circadianPhase: 'morning' | 'afternoon' | 'evening' | 'night';
  /** Session momentum [0..1]: declining = fatigue, rising = engagement. */
  sessionMomentum: number;
  /** Time since last significant cognitive event (ms). */
  timeSinceLastEventMs: number;
}

// ─── Cognitive State ─────────────────────────────────────────────────

export type CognitiveTier = 'reflex' | 'executive' | 'cortex';

export interface CognitiveState {
  /** Unique state snapshot ID. */
  id: string;
  /** Timestamp (ISO 8601). */
  timestamp: string;

  // Perception inputs
  /** Device sensor readings (Termux bridge on mobile). */
  sensors: DeviceSensorReading;
  /** Interaction entropy metrics. */
  interaction: InteractionEntropy;
  /** Emotional inference from local HuggingFace pipeline. */
  emotion: EmotionalInference;
  /** Temporal rhythm (circadian + session). */
  rhythm: TemporalRhythm;

  // Derived cognitive parameters
  /** Current active tier. */
  activeTier: CognitiveTier;
  /** User momentum vector [-1..1]. Negative = disengaging, positive = deepening. */
  userMomentumVector: number;
  /** Structured intent from PerceptionEngine interpretation. */
  structuredIntent: string;
  /** Current atmosphere state. */
  atmosphere: AtmosphereState;

  // Memory context
  /** Summary of Neo4j graph context for current focus. */
  neo4jContextSummary: string;
  /** Active agent status report. */
  activeAgentStatus: string;

  // Constraints
  /** Whether local inference is thermally viable. */
  thermallyViable: boolean;
  /** Whether battery budget allows cortex-tier processing. */
  batteryAllowsCortex: boolean;
  /** Estimated tokens available before OOM. */
  tokenBudgetRemaining: number;
}

// ─── State Transition ────────────────────────────────────────────────

export interface CognitiveStateTransition {
  /** Previous state ID. */
  fromId: string;
  /** New state ID. */
  toId: string;
  /** What triggered the transition. */
  trigger: 'sensor_change' | 'interaction_entropy' | 'emotional_shift' | 'tier_escalation' | 'thermal_constraint' | 'explicit_request';
  /** Timestamp (ISO 8601). */
  timestamp: string;
}

// ─── Utility: default empty states ───────────────────────────────────

export function defaultAtmosphereVisuals(): AtmosphereVisuals {
  return { blur: 0, particleDensity: 0.3, lighting: 0.7, colorTemperature: 6500, motionVelocity: 0.5, focalDepth: 0.5 };
}

export function defaultAtmosphereAudio(): AtmosphereAudio {
  return { cavernVelocity: 0.3, renderingMode: 'binaural', ambientIntensity: 0.2 };
}

export function defaultAtmosphereState(): AtmosphereState {
  return { visuals: defaultAtmosphereVisuals(), audio: defaultAtmosphereAudio(), mood: 'calm', updatedAt: new Date().toISOString() };
}

export function defaultDeviceSensors(): DeviceSensorReading {
  return { acceleration: 0, lightLevel: 500, batteryLevel: 100, thermalState: 'nominal', networkType: 'wifi', formFactor: 'desktop' };
}

export function defaultInteractionEntropy(): InteractionEntropy {
  return { interactionRate: 0, dwellTimeMs: 0, scrollVelocity: 0, sessionDurationSec: 0 };
}

export function defaultEmotionalInference(): EmotionalInference {
  return { valence: 0, arousal: 'low', confidence: 0, source: 'rule_based' };
}

export function defaultTemporalRhythm(): TemporalRhythm {
  const hour = new Date().getHours();
  const circadianPhase = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : hour < 21 ? 'evening' : 'night';
  return { circadianPhase, sessionMomentum: 0.5, timeSinceLastEventMs: 0 };
}

export function defaultCognitiveState(id?: string): CognitiveState {
  return {
    id: id ?? `cs_${Date.now()}`,
    timestamp: new Date().toISOString(),
    sensors: defaultDeviceSensors(),
    interaction: defaultInteractionEntropy(),
    emotion: defaultEmotionalInference(),
    rhythm: defaultTemporalRhythm(),
    activeTier: 'reflex',
    userMomentumVector: 0,
    structuredIntent: '',
    atmosphere: defaultAtmosphereState(),
    neo4jContextSummary: '',
    activeAgentStatus: '',
    thermallyViable: true,
    batteryAllowsCortex: true,
    tokenBudgetRemaining: 2048,
  };
}
