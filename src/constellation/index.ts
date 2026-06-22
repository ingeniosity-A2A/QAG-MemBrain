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
 *   import { constellation } from './src/constellation.js';
 *   const decision = await constellation.route({ prompt, budget: { maxLatencyMs: 200 } });
 */

export { Router, type RoutingRequest, type RoutingDecision } from './Router.js';
export { BackendRegistry, type Backend, type BackendInfo } from './BackendRegistry.js';
export { BudgetCalculator, type Budget, type BudgetEstimate } from './BudgetCalculator.js';
export { HealthChecker, type HealthStatus } from './HealthChecker.js';
export { PolicyStore, type RoutingPolicy } from './PolicyStore.js';
export { Constellation } from './Constellation.js';

import { Constellation } from './Constellation.js';

export const constellation = Constellation.create();
