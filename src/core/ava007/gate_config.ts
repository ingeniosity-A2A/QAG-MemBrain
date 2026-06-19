/**
 * Gate Config – Default and runtime-loaded configuration
 * Ported from ava007/runtime/gate_config.ts into canonical src/.
 */
import type { GateConfig } from './coordination_types.js';

export const DEFAULT_GATE_CONFIG: GateConfig = {
  reflexNfcSources: ['nfc'],
  reflexWebhookSources: ['webhook'],
  reflexKnownWebhookTypes: [],
  reflexKnownPatternTypes: ['nfc_tap'],
  reflexConfidenceThreshold: 0.85,
  reflexMaxPayloadBytes: 2048,
  reflexContextTokenBudget: 100,
  executiveContextTokenBudget: 500,
  cortexContextTokenBudget: 1000,
  executiveEscalationConfidence: 0.6,
  dagMaxDepth: 5,
};

/**
 * Load gate config from environment variables or use defaults.
 * Production: replace with Neo4j-backed config loader.
 */
export function loadGateConfigFromEnv(): GateConfig {
  return {
    ...DEFAULT_GATE_CONFIG,
    reflexConfidenceThreshold: parseFloat(process.env.REFLEX_CONFIDENCE_THRESHOLD ?? '') || DEFAULT_GATE_CONFIG.reflexConfidenceThreshold,
    executiveEscalationConfidence: parseFloat(process.env.EXECUTIVE_ESCALATION_CONFIDENCE ?? '') || DEFAULT_GATE_CONFIG.executiveEscalationConfidence,
    dagMaxDepth: Math.min(5, Math.max(1, parseInt(process.env.DAG_MAX_DEPTH ?? '', 10) || DEFAULT_GATE_CONFIG.dagMaxDepth)),
  };
}
