/**
 * Constellation — AMOS v2.1 dynamic model routing layer.
 *
 * Sits between AVA007/Meta Harness and all inference backends.
 * Routes each inference request to the optimal (model, backend,
 * quantization) tuple based on budget, latency, battery, thermal,
 * and privacy constraints.
 *
 * Architecture:
 *   AVA007 -> Meta Harness -> [CONSTELLATION] -> {QNN NPU, WebGPU, CPU, llamdrop, Cloud}
 *
 * Public API:
 *   import { constellation } from './src/constellation';
 *   const decision = await constellation.route({ prompt, budget: { maxLatencyMs: 200 } });
 */

export { Router, type RoutingRequest, type RoutingDecision } from './Router';
export { BackendRegistry, type Backend, type BackendInfo } from './BackendRegistry';
export { BudgetCalculator, type Budget, type BudgetEstimate } from './BudgetCalculator';
export { HealthChecker, type HealthStatus } from './HealthChecker';
export { PolicyStore, type RoutingPolicy } from './PolicyStore';
export { Constellation } from './Constellation';

import { Constellation } from './Constellation';

export const constellation = Constellation.create();
