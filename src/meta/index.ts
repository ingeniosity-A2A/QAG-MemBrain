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
 *   import { metaHarness } from './src/meta.js';
 *   const result = await metaHarness.intercept({ pillar: 'rev_ike', op: 'reflex', payload });
 */

export { Interceptor, type Intercept, type InterceptionResult } from './Interceptor.js';
export { Validator, type ValidationRule, type ValidationError } from './Validator.js';
export { ConfidenceScorer, type Vote, type ConfidenceScore } from './ConfidenceScorer.js';
export { Arbitrator, type Conflict, type ArbitrationDecision } from './Arbitrator.js';
export { PolicyEngine, type Policy, type PolicyDecision } from './PolicyEngine.js';
export { AuditLogger, type AuditEvent, type AuditReceipt } from './AuditLogger.js';
export {
  LifecycleHooks,
  type LifecyclePhase,
  type LifecycleContext,
  type LifecycleHook,
} from './LifecycleHooks.js';
export { MetaHarness } from './MetaHarness.js';

import { MetaHarness } from './MetaHarness.js';

// Singleton instance — wire up real implementations on first access.
export const metaHarness = MetaHarness.create();
