/**
 * PolicyEngine — boundary enforcement.
 *
 * Loads policies from DuckDB governance store at startup, then evaluates
 * every intercepted call against them. Policies are immutable during a
 * session — to update, restart the runtime or call `reload()`.
 *
 * Policy types:
 *   - rate_limit: max N calls per minute per pillar
 *   - boundary: forbid certain operations entirely
 *   - redaction: scrub sensitive fields from payload before execution
 *   - require_local: force local-only execution (no cloud)
 *   - budget: enforce per-session cost / time / battery limits
 */

import type { Intercept } from './Interceptor';

export interface Policy {
  id: string;
  kind: 'rate_limit' | 'boundary' | 'redaction' | 'require_local' | 'budget';
  pillar?: string;
  operation?: string;
  /** Policy-specific parameters */
  params: Record<string, unknown>;
  /** Human-readable reason for audit logs */
  reason: string;
}

export interface PolicyDecision {
  allow: boolean;
  /** If denied, which policy triggered the denial */
  policy?: string;
  reason: string;
  /** If a redaction policy matched, the redacted payload is returned here */
  redactedPayload?: unknown;
}

interface RateLimitState {
  count: number;
  windowStart: number;
}

export class PolicyEngine {
  private policies: Policy[] = [];
  private rateLimitState: Map<string, RateLimitState> = new Map();

  /** Load policies from the DuckDB governance store (or wherever the source is). */
  load(policies: Policy[]): void {
    this.policies = [...policies];
  }

  /** Reload policies at runtime (e.g. after a governance update). */
  reload(policies: Policy[]): void {
    this.policies = [...policies];
    this.rateLimitState.clear();
  }

  list(): Policy[] {
    return [...this.policies];
  }

  evaluate(intercept: Intercept): PolicyDecision {
    let currentPayload: unknown = intercept.payload;

    for (const policy of this.policies) {
      if (policy.pillar && policy.pillar !== intercept.pillar) continue;
      if (policy.operation && policy.operation !== intercept.operation) continue;

      switch (policy.kind) {
        case 'boundary': {
          return {
            allow: false,
            policy: policy.id,
            reason: `boundary policy '${policy.id}' forbids this operation: ${policy.reason}`,
          };
        }

        case 'rate_limit': {
          const windowMs = (policy.params.windowMs as number) ?? 60_000;
          const max = (policy.params.max as number) ?? 100;
          const key = `${policy.id}:${intercept.pillar}:${intercept.operation}`;
          const now = Date.now();
          const state = this.rateLimitState.get(key);
          if (!state || now - state.windowStart > windowMs) {
            this.rateLimitState.set(key, { count: 1, windowStart: now });
          } else {
            state.count += 1;
            if (state.count > max) {
              return {
                allow: false,
                policy: policy.id,
                reason: `rate_limit '${policy.id}' exceeded: ${state.count}/${max} in ${windowMs}ms`,
              };
            }
          }
          break;
        }

        case 'require_local': {
          if (!intercept.metadata?.requireLocal) {
            // Caller didn't opt into local-only — flag it
            return {
              allow: false,
              policy: policy.id,
              reason: `require_local policy '${policy.id}' requires metadata.requireLocal=true`,
            };
          }
          break;
        }

        case 'redaction': {
          const fields = (policy.params.fields as string[]) ?? [];
          currentPayload = redactFields(currentPayload, fields);
          break;
        }

        case 'budget': {
          // Budget enforcement is handled at the session level by AuditLogger +
          // a separate BudgetTracker (not implemented in this stub). Here we
          // just check the per-call deadline if specified.
          const maxMs = policy.params.maxCallMs as number | undefined;
          if (maxMs !== undefined && intercept.metadata?.deadlineMs === undefined) {
            // Inject a deadline if policy mandates one
            intercept.metadata = intercept.metadata ?? {};
            intercept.metadata.deadlineMs = maxMs;
          }
          break;
        }
      }
    }

    return {
      allow: true,
      reason: 'all policies passed',
      redactedPayload: currentPayload,
    };
  }
}

function redactFields(payload: unknown, fields: string[]): unknown {
  if (typeof payload !== 'object' || payload === null) return payload;
  if (Array.isArray(payload)) {
    return payload.map(item => redactFields(item, fields));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
    if (fields.includes(k)) {
      out[k] = '[REDACTED]';
    } else if (typeof v === 'object' && v !== null) {
      out[k] = redactFields(v, fields);
    } else {
      out[k] = v;
    }
  }
  return out;
}
