/**
 * Escalation Gates – Reflex and Executive gate evaluation
 * Ported from ava007/runtime/escalation_gates.ts into canonical src/.
 * Self-contained: uses types from ./coordination_types.js.
 */
import type {
  Atom,
  AtomImportance,
  DagSlice,
  GateConfig,
  Mellum2Response,
  PolicyConflict,
  RuntimeAction,
  PatternCache,
  FingerprintCache,
  ReflexGateDecision,
  ReflexGateReason,
  ExecutiveGateDecision,
  ExecutiveGateReason,
} from './coordination_types.js';

// ─── Helpers ─────────────────────────────────────────────────────────

function payloadBytes(atom: Atom): number {
  return Buffer.byteLength(JSON.stringify(atom.payload), 'utf8');
}

export function stablePatternHash(atom: Atom): string {
  if (atom.sha256) return atom.sha256;
  const payloadKeys = Object.keys(atom.payload).sort().join(',');
  return `${atom.source}:${atom.type}:${payloadKeys}`;
}

function booleanPayloadFlag(atom: Atom, key: string): boolean {
  return atom.payload[key] === true;
}

// ─── Reflex Gate ─────────────────────────────────────────────────────

export function evaluateReflexGate(input: {
  atom: Atom;
  config: GateConfig;
  patternCache?: PatternCache;
  fingerprintCache?: FingerprintCache;
}): ReflexGateDecision {
  const patternHash = stablePatternHash(input.atom);
  const size = payloadBytes(input.atom);
  const confidence = input.atom.confidence ?? 0;
  const importance = input.atom.importance ?? 'medium';
  const base = { patternHash, payloadBytes: size, confidence, threshold: input.config.reflexConfidenceThreshold, importance };

  if (booleanPayloadFlag(input.atom, 'requiresCortex')) {
    return { target: 'executive', reason: 'explicit_cortex_request', ...base };
  }
  if (booleanPayloadFlag(input.atom, 'requiresExecutive')) {
    return { target: 'executive', reason: 'explicit_executive_request', ...base };
  }
  if (input.atom.type === 'document' || input.atom.source === 'document_upload') {
    return { target: 'executive', reason: 'document_upload', ...base };
  }
  if (importance === 'critical') {
    return { target: 'executive', reason: 'critical_importance', ...base };
  }
  if (confidence < input.config.reflexConfidenceThreshold) {
    return { target: 'executive', reason: 'ingestion_confidence_below_threshold', ...base };
  }
  if (importance !== 'low' && importance !== 'medium') {
    return { target: 'executive', reason: 'importance_above_reflex', ...base };
  }
  if (input.atom.multiAtomContextRequired === true) {
    return { target: 'executive', reason: 'multi_atom_context_required', ...base };
  }
  if ((input.atom.unresolvedDagDependencyIds ?? []).length > 0) {
    return { target: 'executive', reason: 'unresolved_dag_dependencies', ...base };
  }
  if ((input.atom.policyIds ?? []).length > 0) {
    return { target: 'executive', reason: 'policy_context_required', ...base };
  }
  if (size > input.config.reflexMaxPayloadBytes) {
    return { target: 'executive', reason: 'payload_over_reflex_budget', ...base };
  }

  // Cache hits → reflex resolution (0 LLM tokens)
  if (input.atom.sha256 && input.fingerprintCache?.has(input.atom.sha256)) {
    return { target: 'reflex', reason: 'fingerprint_cache_hit', action: 'resolve_cached_tween', ...base };
  }
  if (input.atom.type === 'a2a_task' && input.patternCache?.has(patternHash)) {
    return { target: 'reflex', reason: 'cached_a2a_task', action: 'resolve_cached_tween', ...base };
  }
  if (input.patternCache?.has(patternHash)) {
    return { target: 'reflex', reason: 'gsap_tween_cache_hit', action: 'resolve_cached_tween', ...base };
  }

  // Known NFC / webhook shapes → reflex
  if (input.config.reflexNfcSources.includes(input.atom.source) || input.atom.type === 'nfc_tap') {
    return { target: 'reflex', reason: 'known_nfc_shape', action: 'resolve_nfc_tap', ...base };
  }
  if (input.config.reflexWebhookSources.includes(input.atom.source) || input.config.reflexKnownWebhookTypes.includes(input.atom.type)) {
    return { target: 'reflex', reason: 'known_webhook_shape', action: 'resolve_webhook', ...base };
  }
  if (input.config.reflexKnownPatternTypes.includes(input.atom.type)) {
    return { target: 'reflex', reason: 'known_webhook_shape', action: 'resolve_webhook', ...base };
  }

  return { target: 'executive', reason: 'unknown_shape', ...base };
}

// ─── Executive Gate ──────────────────────────────────────────────────

function dagPathExists(dagSlice: DagSlice): boolean {
  return dagSlice.relationships.length > 0 || dagSlice.nodes.length > 1;
}

function hasKnownDagMatch(dagSlice: DagSlice, atom: Atom): boolean {
  return dagSlice.nodes.some((node) => {
    const nodeType = node.properties.type;
    return node.id !== atom.id && (nodeType === atom.type || node.labels.includes(atom.type));
  });
}

export function evaluateExecutiveGate(input: {
  decision: Mellum2Response;
  config: GateConfig;
  dagSlice: DagSlice;
  policyConflicts: PolicyConflict[];
  atom: Atom;
}): ExecutiveGateDecision {
  const base = {
    confidence: input.decision.confidence,
    threshold: input.config.executiveEscalationConfidence,
    policyConflictCount: input.policyConflicts.length,
    dagNodeCount: input.dagSlice.nodes.length,
    dagPathExists: dagPathExists(input.dagSlice),
  };

  if (input.atom.importance === 'critical') return { target: 'cortex', reason: 'critical_importance', ...base };
  if (!base.dagPathExists) return { target: 'cortex', reason: 'dag_path_missing', ...base };
  if (!hasKnownDagMatch(input.dagSlice, input.atom)) return { target: 'cortex', reason: 'novel_type_without_dag_match', ...base };
  if (input.policyConflicts.length > 0) return { target: 'cortex', reason: 'policy_conflict_detected', ...base };
  if (input.decision.policyChangeRequired || input.decision.proposedPolicy) return { target: 'cortex', reason: 'novel_policy_required', ...base };
  if (input.decision.subAgentDelegationSufficient === false) return { target: 'cortex', reason: 'sub_agent_delegation_insufficient', ...base };
  if (input.atom.importance === 'low') return { target: 'cortex', reason: 'importance_outside_executive', ...base };
  if (input.decision.confidence < input.config.executiveEscalationConfidence) return { target: 'cortex', reason: 'mellum_confidence_below_threshold', ...base };
  if (input.decision.decision === 'escalate_to_cortex') return { target: 'cortex', reason: 'mellum_requested_cortex', ...base };

  return { target: 'executive', reason: 'executive_completed', ...base };
}
