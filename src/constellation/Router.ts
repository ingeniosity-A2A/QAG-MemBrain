/**
 * Router — main routing logic for Constellation.
 *
 * Decision algorithm:
 *   1. Filter backends by health (HealthChecker) and policy (PolicyStore)
 *   2. For each surviving backend, estimate latency/battery/cost (BudgetCalculator)
 *   3. Filter by hard constraints in the request (maxLatencyMs, requireLocal, etc.)
 *   4. Score remaining candidates: score = w1*latency_fit + w2*battery_fit + w3*quality
 *   5. Pick highest score; if none survives, return RoutingError
 */

import type { BackendRegistry, Backend, BackendInfo } from './BackendRegistry.js';
import type { BudgetCalculator, Budget, BudgetEstimate } from './BudgetCalculator.js';
import type { HealthChecker, HealthStatus } from './HealthChecker.js';
import type { PolicyStore, RoutingPolicy } from './PolicyStore.js';

export interface RoutingRequest {
  prompt: string;
  /** Hard constraints */
  budget?: Budget;
  /** Force local-only (no cloud) — overrides any policy that allows cloud */
  requireLocal?: boolean;
  /** Hint: what kind of task is this? (helps pick model) */
  task?: 'reflex' | 'planning' | 'code' | 'math' | 'reasoning' | 'general';
  /** Min confidence threshold for the chosen model (defaults to 0.7) */
  minConfidence?: number;
}

export interface RoutingDecision {
  backend: Backend;
  modelId: string;
  quantization: Quantization;
  estimatedLatencyMs: number;
  estimatedBatteryPct: number;
  estimatedCostUsd: number;
  confidence: number;
  /** Why this backend was chosen */
  rationale: string;
  /** Alternatives considered (top 3 by score) */
  alternatives: Array<{ backend: Backend; modelId: string; score: number; reason: string }>;
}

export type Quantization = 'q0f32' | 'q4f16' | 'q4f32' | 't_man_1.58';

export type RoutingError =
  | { kind: 'no_backend_available' }
  | { kind: 'budget_exceeded'; constraint: keyof Budget; requested: number; max: number }
  | { kind: 'all_unhealthy' };

export class Router {
  // Default scoring weights — tunable via PolicyStore
  private weights = { latency: 0.4, battery: 0.3, quality: 0.3 };

  constructor(
    private readonly backends: BackendRegistry,
    private readonly budget: BudgetCalculator,
    private readonly health: HealthChecker,
    private readonly policies: PolicyStore,
  ) {}

  async route(req: RoutingRequest): Promise<RoutingDecision> {
    // 1. Apply policies — may inject constraints
    const policies = this.policies.list();
    const effectiveReq = applyPolicies(req, policies);

    // 2. Enumerate all registered backends
    const allBackends = this.backends.list();
    if (allBackends.length === 0) {
      throw routingError({ kind: 'no_backend_available' });
    }

    // 3. Filter by health
    const healthyBackends: BackendInfo[] = [];
    for (const b of allBackends) {
      const status = this.health.status(b.backend);
      if (status.healthy) {
        healthyBackends.push(b);
      }
    }
    if (healthyBackends.length === 0) {
      throw routingError({ kind: 'all_unhealthy' });
    }

    // 4. Filter by requireLocal
    const localityFiltered = effectiveReq.requireLocal
      ? healthyBackends.filter(b => b.backend !== 'cloud')
      : healthyBackends;

    // 5. Compute estimates for each candidate
    const estimates: Array<{
      info: BackendInfo;
      estimate: BudgetEstimate;
      score: number;
    }> = [];
    for (const info of localityFiltered) {
      const estimate = this.budget.estimate(info, effectiveReq);
      // Hard constraint checks
      if (effectiveReq.budget?.maxLatencyMs !== undefined && estimate.latencyMs > effectiveReq.budget.maxLatencyMs) {
        continue;
      }
      if (effectiveReq.budget?.maxBatteryPct !== undefined && estimate.batteryPct > effectiveReq.budget.maxBatteryPct) {
        continue;
      }
      if (effectiveReq.budget?.maxCostUsd !== undefined && estimate.costUsd > effectiveReq.budget.maxCostUsd) {
        continue;
      }
      // Compute score (higher is better)
      const latencyFit = 1 - Math.min(1, estimate.latencyMs / 1000);
      const batteryFit = 1 - Math.min(1, estimate.batteryPct / 5);
      const qualityFit = info.quality;
      const score = this.weights.latency * latencyFit + this.weights.battery * batteryFit + this.weights.quality * qualityFit;
      estimates.push({ info, estimate, score });
    }

    if (estimates.length === 0) {
      throw routingError({ kind: 'no_backend_available' });
    }

    // 6. Sort by score descending
    estimates.sort((a, b) => b.score - a.score);
    const winner = estimates[0];

    // 7. Build decision
    const alternatives = estimates.slice(1, 4).map(e => ({
      backend: e.info.backend,
      modelId: e.info.defaultModelId,
      score: e.score,
      reason: `score=${e.score.toFixed(3)}`,
    }));

    return {
      backend: winner.info.backend,
      modelId: winner.info.defaultModelId,
      quantization: winner.info.defaultQuantization,
      estimatedLatencyMs: winner.estimate.latencyMs,
      estimatedBatteryPct: winner.estimate.batteryPct,
      estimatedCostUsd: winner.estimate.costUsd,
      confidence: winner.info.quality,
      rationale: `highest score ${winner.score.toFixed(3)} (latency=${winner.estimate.latencyMs}ms, battery=${winner.estimate.batteryPct}%, quality=${winner.info.quality.toFixed(2)})`,
      alternatives,
    };
  }

  /** Override default scoring weights. */
  setWeights(w: { latency: number; battery: number; quality: number }): void {
    const sum = w.latency + w.battery + w.quality;
    if (Math.abs(sum - 1) > 0.001) {
      throw new Error(`weights must sum to 1.0, got ${sum}`);
    }
    this.weights = w;
  }
}

function applyPolicies(req: RoutingRequest, policies: RoutingPolicy[]): RoutingRequest {
  let effective: RoutingRequest = { ...req };
  for (const p of policies) {
    if (p.kind === 'force_local' && !effective.requireLocal) {
      effective.requireLocal = true;
    } else if (p.kind === 'budget_cap' && !effective.budget) {
      effective.budget = p.params.budget as Budget;
    } else if (p.kind === 'prefer_backend') {
      // Scoring weight tweak — handled in PolicyStore, not here
    }
  }
  return effective;
}

function routingError(e: RoutingError): Error {
  const err = new Error(`RoutingError: ${e.kind}`) as Error & { routingError: RoutingError };
  err.routingError = e;
  return err;
}
