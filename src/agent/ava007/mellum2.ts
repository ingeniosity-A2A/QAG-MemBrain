/**
 * Mellum2 – Executive LLM Client
 * Ported from ava007/runtime/executive.ts concepts.
 * The executive tier uses Mellum2 (~500 tokens) for intermediate decisions.
 * Deterministic stub for dev; swap with HTTP client for production.
 */
import type {
  Mellum2Client,
  Mellum2Request,
  Mellum2Response,
} from './coordination_types.js';

// ─── Deterministic (stub) implementation ─────────────────────────────

export class DeterministicMellum2Client implements Mellum2Client {
  async evaluate(request: Mellum2Request): Promise<Mellum2Response> {
    const atom = request.atom;
    const confidence = atom.confidence ?? 0.5;
    const importance = atom.importance ?? 'medium';

    // Known shapes resolved at executive level
    if (atom.type === 'nfc_tap' || atom.source === 'nfc') {
      return {
        decision: 'resolve_nfc_tap',
        action: 'resolve_nfc_tap',
        confidence: 0.95,
        reason: 'Known NFC tap shape resolved by Mellum2 executive.',
      };
    }

    if (atom.type === 'webhook' || atom.source === 'webhook') {
      return {
        decision: 'resolve_webhook',
        action: 'resolve_webhook',
        confidence: 0.9,
        reason: 'Known webhook shape resolved by Mellum2 executive.',
      };
    }

    // Policy conflicts require cortex
    if (request.policyConflicts.length > 0) {
      return {
        decision: 'escalate_to_cortex',
        action: 'escalate_to_cortex',
        confidence,
        reason: 'Policy conflicts detected — escalation to cortex required.',
        policyChangeRequired: true,
      };
    }

    // Critical importance always escalates
    if (importance === 'critical') {
      return {
        decision: 'escalate_to_cortex',
        action: 'escalate_to_cortex',
        confidence,
        reason: 'Critical importance — escalation to cortex required.',
      };
    }

    // Low confidence escalates
    if (confidence < request.gateConfig.executiveEscalationConfidence) {
      return {
        decision: 'escalate_to_cortex',
        action: 'escalate_to_cortex',
        confidence,
        reason: `Confidence ${confidence} below threshold ${request.gateConfig.executiveEscalationConfidence}.`,
      };
    }

    // Default: executive action
    return {
      decision: 'executive_action',
      action: 'executive_action',
      confidence: Math.min(confidence + 0.1, 1),
      reason: `Mellum2 executive resolved ${atom.type} from ${atom.source}.`,
    };
  }
}

// ─── HTTP implementation ─────────────────────────────────────────────

export class HttpMellum2Client implements Mellum2Client {
  constructor(private readonly endpoint: string) {}

  async evaluate(request: Mellum2Request): Promise<Mellum2Response> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        atom: request.atom,
        dag_slice: request.dagSlice,
        policy_conflicts: request.policyConflicts,
        gate_config: request.gateConfig,
      }),
    });

    if (!response.ok) {
      throw new Error(`Mellum2 evaluation failed with status ${response.status}`);
    }

    const parsed = (await response.json()) as Partial<Mellum2Response>;
    if (
      typeof parsed.action !== 'string' ||
      typeof parsed.confidence !== 'number' ||
      typeof parsed.reason !== 'string'
    ) {
      throw new Error('Mellum2 evaluation response is malformed');
    }

    return {
      decision: parsed.decision ?? parsed.action,
      action: parsed.action,
      confidence: parsed.confidence,
      reason: parsed.reason,
      subAgentDelegationSufficient: parsed.subAgentDelegationSufficient,
      policyChangeRequired: parsed.policyChangeRequired,
      proposedPolicy: parsed.proposedPolicy,
    };
  }
}
