/**
 * Interceptor — universal entry point for Meta Harness.
 *
 * Every subsystem call flows through here:
 *   1. observe (audit)
 *   2. validate (schema + policy)
 *   3. arbitrate (if multi-agent)
 *   4. execute (delegate to actual subsystem)
 *   5. audit result with TASHI receipt
 */

import type { Validator } from './Validator.js';
import type { PolicyEngine, PolicyDecision } from './PolicyEngine.js';
import type { AuditLogger, AuditEvent } from './AuditLogger.js';
import type { Arbitrator } from './Arbitrator.js';

export type Pillar =
  | 'ava007'
  | 'rev_ike'
  | 'fable'
  | 'goose'
  | 'tashi'
  | 'constellation'
  | 'epoch'
  | 'temporal';

export interface Intercept {
  pillar: Pillar;
  operation: string;
  payload: unknown;
  /** Optional caller-provided execution function. If omitted, intercept
   * returns the validated payload and the caller is responsible for
   * actually executing the operation. */
  execute?: (payload: unknown) => Promise<unknown>;
  /** Per-call metadata: session id, trace id, deadline_ms, etc. */
  metadata?: {
    sessionId?: string;
    traceId?: string;
    deadlineMs?: number;
    requireLocal?: boolean;
    confidenceThreshold?: number;
  };
}

export interface InterceptionResult {
  allowed: boolean;
  result?: unknown;
  error?: InterceptionError;
  auditEvent: AuditEvent;
  policyDecision: PolicyDecision;
  durationMs: number;
}

export type InterceptionError =
  | { kind: 'validation_failed'; details: string[] }
  | { kind: 'policy_violation'; policy: string; reason: string }
  | { kind: 'confidence_too_low'; score: number; threshold: number }
  | { kind: 'arbitration_failed'; conflicts: string[] }
  | { kind: 'execution_failed'; cause: string }
  | { kind: 'deadline_exceeded'; deadlineMs: number };

export class Interceptor {
  constructor(
    private readonly validator: Validator,
    private readonly policyEngine: PolicyEngine,
    private readonly auditLogger: AuditLogger,
    private readonly arbitrator: Arbitrator,
  ) {}

  async intercept(intercept: Intercept): Promise<InterceptionResult> {
    const startedAt = Date.now();
    const traceId = intercept.metadata?.traceId ?? generateTraceId();

    // 1. Observe — emit pre-execution audit event
    const preEvent: AuditEvent = {
      traceId,
      sessionId: intercept.metadata?.sessionId,
      pillar: intercept.pillar,
      operation: intercept.operation,
      phase: 'pre',
      timestamp: new Date().toISOString(),
    };
    this.auditLogger.log(preEvent);

    // 2. Validate (schema + structural checks)
    const validation = this.validator.validate(intercept);
    if (!validation.ok) {
      const err: InterceptionError = {
        kind: 'validation_failed',
        details: validation.errors,
      };
      const failEvent: AuditEvent = {
        ...preEvent,
        phase: 'validation_failed',
        error: err,
      };
      this.auditLogger.log(failEvent);
      return {
        allowed: false,
        error: err,
        auditEvent: failEvent,
        policyDecision: { allow: false, reason: 'validation_failed' },
        durationMs: Date.now() - startedAt,
      };
    }

    // 3. Policy check
    const policyDecision = this.policyEngine.evaluate(intercept);
    if (!policyDecision.allow) {
      const err: InterceptionError = {
        kind: 'policy_violation',
        policy: policyDecision.policy ?? 'unknown',
        reason: policyDecision.reason,
      };
      const failEvent: AuditEvent = {
        ...preEvent,
        phase: 'policy_violation',
        error: err,
      };
      this.auditLogger.log(failEvent);
      return {
        allowed: false,
        error: err,
        auditEvent: failEvent,
        policyDecision,
        durationMs: Date.now() - startedAt,
      };
    }

    // 4. Execute (if caller provided an executor)
    let result: unknown = undefined;
    if (intercept.execute) {
      try {
        const deadline = intercept.metadata?.deadlineMs;
        result = deadline !== undefined
          ? await withDeadline(intercept.execute(intercept.payload), deadline)
          : await intercept.execute(intercept.payload);
      } catch (e) {
        const err: InterceptionError = {
          kind: 'execution_failed',
          cause: e instanceof Error ? e.message : String(e),
        };
        const failEvent: AuditEvent = {
          ...preEvent,
          phase: 'execution_failed',
          error: err,
        };
        this.auditLogger.log(failEvent);
        return {
          allowed: false,
          error: err,
          auditEvent: failEvent,
          policyDecision,
          durationMs: Date.now() - startedAt,
        };
      }
    }

    // 5. Post-execution audit
    const postEvent: AuditEvent = {
      ...preEvent,
      phase: 'post',
      resultSummary: summarizeResult(result),
    };
    this.auditLogger.log(postEvent);

    return {
      allowed: true,
      result,
      auditEvent: postEvent,
      policyDecision,
      durationMs: Date.now() - startedAt,
    };
  }
}

function generateTraceId(): string {
  return 'trc_' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
}

function summarizeResult(result: unknown): string {
  if (result === undefined) return 'undefined';
  if (result === null) return 'null';
  if (typeof result === 'string') return `string(len=${result.length})`;
  if (typeof result === 'number') return `number(${result})`;
  if (typeof result === 'boolean') return `boolean(${result})`;
  if (Array.isArray(result)) return `array(len=${result.length})`;
  if (typeof result === 'object') return `object(keys=${Object.keys(result).length})`;
  return typeof result;
}

function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`__deadline_exceeded:${ms}__`));
    }, ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}
