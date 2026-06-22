/**
 * HealthChecker — real-time health monitoring for each backend.
 *
 * For local backends (QNN NPU, WebGPU, CPU, llamdrop): probe on a timer
 * (default: every 10s) by running a tiny inference and timing it.
 *
 * For cloud backends: HTTP HEAD on the model endpoint with a short timeout.
 *
 * If a backend fails 3 probes in a row, it's marked unhealthy and the
 * Router skips it until recovery.
 */

import type { Backend } from './BackendRegistry';

export interface HealthStatus {
  backend: Backend;
  healthy: boolean;
  /** Last successful probe timestamp (ms since epoch) */
  lastOk: number | null;
  /** Consecutive failure count */
  consecutiveFailures: number;
  /** Most recent error message (if any) */
  lastError: string | null;
  /** Rolling p50 latency in ms (over last 100 probes) */
  p50LatencyMs: number | null;
  /** Rolling p99 latency in ms (over last 100 probes) */
  p99LatencyMs: number | null;
}

export class HealthChecker {
  private states: Map<Backend, HealthStatus> = new Map();
  private timers: Map<Backend, ReturnType<typeof setInterval>> = new Map();
  private probeIntervalMs = 10_000;
  private failureThreshold = 3;
  /** Probe function — replaced by Mobile Runtime with actual probes. */
  private probeFn: (backend: Backend) => Promise<{ ok: boolean; latencyMs?: number; error?: string }> = async (_b) => {
    // Default: assume healthy. Real impl injected by runtime.
    return { ok: true, latencyMs: 0 };
  };

  setProbeFn(fn: (backend: Backend) => Promise<{ ok: boolean; latencyMs?: number; error?: string }>): void {
    this.probeFn = fn;
  }

  startMonitoring(backend: Backend): void {
    if (this.timers.has(backend)) return;
    this.states.set(backend, {
      backend,
      healthy: true,
      lastOk: null,
      consecutiveFailures: 0,
      lastError: null,
      p50LatencyMs: null,
      p99LatencyMs: null,
    });
    const timer = setInterval(() => {
      void this.probe(backend).catch(() => {});
    }, this.probeIntervalMs);
    this.timers.set(backend, timer);
  }

  stopMonitoring(backend: Backend): void {
    const timer = this.timers.get(backend);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(backend);
    }
    this.states.delete(backend);
  }

  stopAll(): void {
    for (const backend of Array.from(this.timers.keys())) {
      this.stopMonitoring(backend);
    }
  }

  status(backend: Backend): HealthStatus {
    return this.states.get(backend) ?? {
      backend,
      healthy: false,
      lastOk: null,
      consecutiveFailures: 0,
      lastError: 'not monitored',
      p50LatencyMs: null,
      p99LatencyMs: null,
    };
  }

  /** Run a single probe and update state. */
  async probe(backend: Backend): Promise<HealthStatus> {
    const result = await this.probeFn(backend);
    const state = this.states.get(backend) ?? this.freshState(backend);
    if (result.ok) {
      state.healthy = true;
      state.lastOk = Date.now();
      state.consecutiveFailures = 0;
      state.lastError = null;
      if (result.latencyMs !== undefined) {
        // TODO: maintain a proper ring buffer + percentile calc
        state.p50LatencyMs = result.latencyMs;
        state.p99LatencyMs = result.latencyMs;
      }
    } else {
      state.consecutiveFailures += 1;
      state.lastError = result.error ?? 'unknown';
      if (state.consecutiveFailures >= this.failureThreshold) {
        state.healthy = false;
      }
    }
    this.states.set(backend, state);
    return state;
  }

  private freshState(backend: Backend): HealthStatus {
    return {
      backend,
      healthy: true,
      lastOk: null,
      consecutiveFailures: 0,
      lastError: null,
      p50LatencyMs: null,
      p99LatencyMs: null,
    };
  }
}
