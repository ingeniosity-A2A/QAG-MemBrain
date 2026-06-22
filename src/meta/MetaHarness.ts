/**
 * MetaHarness — singleton orchestrator that ties together all Meta Harness
 * subcomponents (Interceptor, Validator, ConfidenceScorer, Arbitrator,
 * PolicyEngine, AuditLogger, LifecycleHooks).
 */

import { Interceptor, type Intercept, type InterceptionResult } from './Interceptor.js';
import { Validator } from './Validator.js';
import { ConfidenceScorer } from './ConfidenceScorer.js';
import { Arbitrator } from './Arbitrator.js';
import { PolicyEngine } from './PolicyEngine.js';
import { AuditLogger } from './AuditLogger.js';
import { LifecycleHooks } from './LifecycleHooks.js';

export class MetaHarness {
  public readonly interceptor: Interceptor;
  public readonly validator: Validator;
  public readonly confidenceScorer: ConfidenceScorer;
  public readonly arbitrator: Arbitrator;
  public readonly policyEngine: PolicyEngine;
  public readonly auditLogger: AuditLogger;
  public readonly lifecycleHooks: LifecycleHooks;

  private constructor() {
    this.auditLogger = new AuditLogger();
    this.policyEngine = new PolicyEngine();
    this.confidenceScorer = new ConfidenceScorer();
    this.arbitrator = new Arbitrator(this.confidenceScorer);
    this.validator = new Validator(this.policyEngine);
    this.lifecycleHooks = new LifecycleHooks();
    this.interceptor = new Interceptor(
      this.validator,
      this.policyEngine,
      this.auditLogger,
      this.arbitrator,
    );
  }

  private static instance: MetaHarness | null = null;

  static create(): MetaHarness {
    if (!MetaHarness.instance) {
      MetaHarness.instance = new MetaHarness();
    }
    return MetaHarness.instance;
  }

  /** Primary entry point. Wraps any subsystem invocation. */
  async intercept(intercept: Intercept): Promise<InterceptionResult> {
    return this.interceptor.intercept(intercept);
  }

  /** Register a lifecycle hook for a given phase. */
  on(phase: import('./LifecycleHooks.js').LifecyclePhase, hook: import('./LifecycleHooks.js').LifecycleHook): void {
    this.lifecycleHooks.register(phase, hook);
  }
}
