/**
 * Validator — schema + structural validation for any intercepted payload.
 *
 * Real implementation will use a JSON-Schema-like rule registry that the
 * PolicyEngine populates from DuckDB governance store. For now we expose
 * a programmatic rule API + a built-in shape checker.
 */

import type { PolicyEngine } from './PolicyEngine.js';

export interface ValidationRule {
  pillar: string;
  operation: string;
  /** Returns null if valid, or an array of human-readable error strings. */
  check: (payload: unknown) => string[] | null;
}

export interface ValidationError {
  ok: false;
  errors: string[];
}

export interface ValidationOk {
  ok: true;
}

export type ValidationResult = ValidationError | ValidationOk;

export class Validator {
  private rules: Map<string, ValidationRule> = new Map();

  constructor(private readonly policyEngine: PolicyEngine) {
    // Register built-in shape checks for known pillars
    this.registerBuiltins();
  }

  register(rule: ValidationRule): void {
    const key = `${rule.pillar}:${rule.operation}`;
    this.rules.set(key, rule);
  }

  validate(intercept: { pillar: string; operation: string; payload: unknown }): ValidationResult {
    const key = `${intercept.pillar}:${intercept.operation}`;
    const rule = this.rules.get(key);
    if (!rule) {
      // No rule -> allow by default (PolicyEngine is the strict gate)
      return { ok: true };
    }
    const errs = rule.check(intercept.payload);
    if (errs && errs.length > 0) {
      return { ok: false, errors: errs };
    }
    return { ok: true };
  }

  private registerBuiltins(): void {
    // REV.IKE reflex: payload must have `stimulus` string and optional `context` object
    this.register({
      pillar: 'rev_ike',
      operation: 'reflex',
      check: (p) => {
        if (typeof p !== 'object' || p === null) return ['payload must be an object'];
        const obj = p as Record<string, unknown>;
        if (typeof obj.stimulus !== 'string') return ['payload.stimulus must be a string'];
        if (obj.context !== undefined && typeof obj.context !== 'object') {
          return ['payload.context must be an object if present'];
        }
        return null;
      },
    });

    // FABLE plan: payload must have `goal` string and optional `constraints` array
    this.register({
      pillar: 'fable',
      operation: 'plan',
      check: (p) => {
        if (typeof p !== 'object' || p === null) return ['payload must be an object'];
        const obj = p as Record<string, unknown>;
        if (typeof obj.goal !== 'string') return ['payload.goal must be a string'];
        if (obj.constraints !== undefined && !Array.isArray(obj.constraints)) {
          return ['payload.constraints must be an array if present'];
        }
        return null;
      },
    });

    // GOOSE execute: payload must have `tool` string and `args` object
    this.register({
      pillar: 'goose',
      operation: 'execute',
      check: (p) => {
        if (typeof p !== 'object' || p === null) return ['payload must be an object'];
        const obj = p as Record<string, unknown>;
        if (typeof obj.tool !== 'string') return ['payload.tool must be a string'];
        if (typeof obj.args !== 'object' || obj.args === null) {
          return ['payload.args must be an object'];
        }
        return null;
      },
    });

    // TASHI recall: payload must have `query` string and optional `k` number
    this.register({
      pillar: 'tashi',
      operation: 'recall',
      check: (p) => {
        if (typeof p !== 'object' || p === null) return ['payload must be an object'];
        const obj = p as Record<string, unknown>;
        if (typeof obj.query !== 'string') return ['payload.query must be a string'];
        if (obj.k !== undefined && typeof obj.k !== 'number') {
          return ['payload.k must be a number if present'];
        }
        return null;
      },
    });

    // CONSTELLATION route: payload must have `prompt` string and optional `budget` object
    this.register({
      pillar: 'constellation',
      operation: 'route',
      check: (p) => {
        if (typeof p !== 'object' || p === null) return ['payload must be an object'];
        const obj = p as Record<string, unknown>;
        if (typeof obj.prompt !== 'string') return ['payload.prompt must be a string'];
        if (obj.budget !== undefined && typeof obj.budget !== 'object') {
          return ['payload.budget must be an object if present'];
        }
        return null;
      },
    });
  }
}
