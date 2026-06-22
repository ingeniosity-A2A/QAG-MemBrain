/**
 * BudgetCalculator — estimates latency / battery / cost for a given
 * (backend, request) tuple.
 *
 * Estimates are based on:
 *   - Backend characteristics (NPU is fast + low-power, cloud is variable)
 *   - Prompt length (longer prompts = more latency)
 *   - Requested output length (max_tokens)
 *   - Current device thermal state (queried from mobile/performance.ts)
 */

import type { Backend, BackendInfo } from './BackendRegistry.js';
import type { RoutingRequest } from './Router.js';

export interface Budget {
  /** Max acceptable latency in milliseconds */
  maxLatencyMs?: number;
  /** Max acceptable battery percentage to consume (0..100) */
  maxBatteryPct?: number;
  /** Max acceptable cost in USD (cloud backends only) */
  maxCostUsd?: number;
  /** Max acceptable thermal impact (0..1) */
  maxThermal?: number;
}

export interface BudgetEstimate {
  latencyMs: number;
  batteryPct: number;
  costUsd: number;
  thermal: number;
}

// Per-backend baseline characteristics (S25 Ultra, room temp)
const BACKEND_BASELINES: Record<Backend, BudgetEstimate> = {
  qnn_npu:   { latencyMs: 80,  batteryPct: 0.4, costUsd: 0,     thermal: 0.2 },
  webgpu:    { latencyMs: 150, batteryPct: 0.8, costUsd: 0,     thermal: 0.4 },
  cpu:       { latencyMs: 500, batteryPct: 1.5, costUsd: 0,     thermal: 0.6 },
  llamdrop:  { latencyMs: 60,  batteryPct: 0.3, costUsd: 0,     thermal: 0.1 },
  cloud:     { latencyMs: 300, batteryPct: 0.1, costUsd: 0.002, thermal: 0.0 },
};

export class BudgetCalculator {
  /** Current device thermal multiplier (1.0 = nominal, >1 = throttling). */
  private thermalMultiplier = 1.0;

  /** Set by Mobile Runtime when device thermal state changes. */
  setThermalMultiplier(m: number): void {
    if (m < 0.5 || m > 3.0) throw new Error('thermal multiplier must be in [0.5, 3.0]');
    this.thermalMultiplier = m;
  }

  estimate(backend: BackendInfo, req: RoutingRequest): BudgetEstimate {
    const baseline = BACKEND_BASELINES[backend.backend];
    const promptLen = req.prompt.length;
    const outputLen = 256; // Default; production would read from req.maxTokens

    // Linear scaling with prompt + output length
    const lenFactor = 1 + (promptLen / 4096) + (outputLen / 1024);
    const latencyMs = Math.round(baseline.latencyMs * lenFactor * this.thermalMultiplier);

    // Battery scales linearly with latency for local backends
    const batteryPct = +(baseline.batteryPct * lenFactor).toFixed(3);

    // Cost scales with tokens (cloud only)
    const costUsd = backend.backend === 'cloud'
      ? +(((promptLen + outputLen) / 1000) * baseline.costUsd).toFixed(6)
      : 0;

    // Thermal: backends add heat; multiplier reflects current state
    const thermal = Math.min(1.0, baseline.thermal * this.thermalMultiplier);

    return { latencyMs, batteryPct, costUsd, thermal };
  }
}
