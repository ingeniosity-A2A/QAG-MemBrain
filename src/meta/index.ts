/**
 * Meta Harness — AMOS v2.1
 *
 * First-class runtime wrapper that intercepts, validates, governs, and
 * observes every subsystem interaction in AVA007 AMOS.
 *
 * Architecture:
 *   USER -> AVA007 -> [META HARNESS] -> {REV.IKE, FABLE, GOOSE, TASHI, CONSTELLATION}
 *
 * Nothing bypasses Meta Harness.
 *
 * Public API:
 *   import { metaHarness } from './src/meta';
 *   const result = await metaHarness.intercept({ pillar: 'rev_ike', op: 'reflex', payload });
 */

export { Interceptor, type Intercept, type InterceptionResult } from './Interceptor';
export { Validator, type ValidationRule, type ValidationError } from './Validator';
export { ConfidenceScorer, type Vote, type ConfidenceScore } from './ConfidenceScorer';
export { Arbitrator, type Conflict, type ArbitrationDecision } from './Arbitrator';
export { PolicyEngine, type Policy, type PolicyDecision } from './PolicyEngine';
export { AuditLogger, type AuditEvent, type AuditReceipt } from './AuditLogger';
export {
  LifecycleHooks,
  type LifecyclePhase,
  type LifecycleContext,
  type LifecycleHook,
} from './LifecycleHooks';
export { MetaHarness } from './MetaHarness';

import { MetaHarness } from './MetaHarness';

// Singleton instance — wire up real implementations on first access.
export const metaHarness = MetaHarness.create();
