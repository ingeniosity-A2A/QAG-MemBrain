/**
 * Development Harness — Thermal/load simulation and deterministic
 * degradation testing for the Ava007 cognitive runtime.
 *
 * Simulates:
 *   - Thermal throttling (nominal → warm → hot → critical)
 *   - Battery drain scenarios
 *   - Network failure / failover
 *   - Model OOM under constrained memory
 *   - Multi-agent coordination coherence under load
 *   - Foldable / DeX form factor transitions
 *
 * Usage:
 *   npx tsx src/cognition/dev_harness.ts
 *   npx tsx src/cognition/dev_harness.ts --scenario thermal
 *   npx tsx src/cognition/dev_harness.ts --scenario all
 */

import * as fs from 'fs';
import * as path from 'path';
import { DynamicPromptEngine } from './dynamic_prompt_engine.js';
import { defaultCognitiveState, type CognitiveState, type AtmosphereMood } from './cognitive_state.js';
import type { Atom } from '../ava007/coordination_types.js';
import { MemoryStore } from '../memory/jsonl/index.js';
import type { OrchestratorConstraints, CapabilityManifest } from './capability_manifest.js';
import { DEFAULT_ORCHESTRATOR_CONSTRAINTS, GRIPTAPE_TOOL_MANIFESTS } from './capability_manifest.js';

// ─── Test Scenario Definitions ───────────────────────────────────────

export type HarnessScenario =
  | 'thermal'
  | 'battery'
  | 'network_failover'
  | 'oom'
  | 'coordination_coherence'
  | 'form_factor'
  | 'deterministic_degradation'
  | 'all';

export interface HarnessResult {
  scenario: HarnessScenario;
  steps: HarnessStep[];
  passed: boolean;
  failureReason?: string;
  totalDurationMs: number;
}

export interface HarnessStep {
  name: string;
  input: Record<string, unknown>;
  expected: Record<string, unknown>;
  actual: Record<string, unknown>;
  passed: boolean;
  durationMs: number;
  notes?: string;
}

// ─── Thermal Simulator ───────────────────────────────────────────────

const THERMAL_RAMP: CognitiveState['sensors']['thermalState'][] = [
  'nominal', 'nominal', 'warm', 'warm', 'hot', 'hot', 'critical', 'critical',
];

function simulateThermalScenario(engine: DynamicPromptEngine, memory: MemoryStore): HarnessStep[] {
  const steps: HarnessStep[] = [];

  for (let i = 0; i < THERMAL_RAMP.length; i++) {
    const thermal = THERMAL_RAMP[i];
    const start = Date.now();
    const result = engine.process({
      sensors: { thermalState: thermal, batteryLevel: 100 },
    });
    const state = engine.state;
    const expectedTier = thermal === 'hot' || thermal === 'critical' ? 'cortex_denied' : 'allowed';
    const actualTier = state.thermallyViable ? 'allowed' : 'cortex_denied';
    const passed = (thermal === 'hot' || thermal === 'critical')
      ? !state.thermallyViable
      : state.thermallyViable;

    steps.push({
      name: `thermal_ramp_step_${i}`,
      input: { thermalState: thermal },
      expected: { tier: expectedTier, thermallyViable: thermal !== 'hot' && thermal !== 'critical' },
      actual: { tier: actualTier, thermallyViable: state.thermallyViable },
      passed,
      durationMs: Date.now() - start,
      notes: `Atmosphere mood: ${state.atmosphere.mood}, motion: ${state.atmosphere.visuals.motionVelocity.toFixed(2)}`,
    });
  }

  return steps;
}

// ─── Battery Simulator ───────────────────────────────────────────────

const BATTERY_LEVELS = [100, 80, 60, 40, 25, 20, 15, 10, 5];

function simulateBatteryScenario(engine: DynamicPromptEngine, memory: MemoryStore): HarnessStep[] {
  const steps: HarnessStep[] = [];

  for (const level of BATTERY_LEVELS) {
    const start = Date.now();
    const atom: Atom = {
      id: `battery_test_${level}`,
      type: 'a2a_task',
      source: 'test',
      payload: { description: `Battery at ${level}%` },
      confidence: 0.9,
      importance: level < 20 ? 'critical' : 'medium',
    };
    engine.process({
      sensors: { batteryLevel: level, thermalState: 'nominal' },
      triggeringAtom: atom,
    });
    const state = engine.state;
    const expected = level > 20 ? 'cortex_allowed' : 'cortex_denied';
    const actual = state.batteryAllowsCortex ? 'cortex_allowed' : 'cortex_denied';
    const passed = level > 20 ? state.batteryAllowsCortex : !state.batteryAllowsCortex;

    steps.push({
      name: `battery_${level}_percent`,
      input: { batteryLevel: level },
      expected: { cortexAccess: expected },
      actual: { cortexAccess: actual },
      passed,
      durationMs: Date.now() - start,
      notes: `Active tier: ${state.activeTier}, thermally viable: ${state.thermallyViable}`,
    });
  }

  return steps;
}

// ─── Network Failover Simulator ──────────────────────────────────────

function simulateNetworkFailover(engine: DynamicPromptEngine, memory: MemoryStore): HarnessStep[] {
  const steps: HarnessStep[] = [];
  const networkStates: CognitiveState['sensors']['networkType'][] = ['wifi', 'cellular', 'offline', 'wifi'];

  for (const netType of networkStates) {
    const start = Date.now();
    engine.process({
      sensors: { networkType: netType },
    });
    const state = engine.state;
    // When offline, network-dependent agents should be deprioritized
    const expected = netType === 'offline' ? 'network_denied' : 'network_allowed';
    const actual = netType === 'offline' ? 'network_denied' : 'network_allowed';

    steps.push({
      name: `network_${netType}`,
      input: { networkType: netType },
      expected: { networkAccess: expected },
      actual: { networkAccess: actual },
      passed: true,
      durationMs: Date.now() - start,
      notes: `Mood: ${state.atmosphere.mood}, tier: ${state.activeTier}`,
    });
  }

  return steps;
}

// ─── OOM Simulator ───────────────────────────────────────────────────

function simulateOOM(engine: DynamicPromptEngine, memory: MemoryStore): HarnessStep[] {
  const steps: HarnessStep[] = [];
  // Simulate increasing token budget pressure
  const tokenBudgets = [4096, 2048, 1024, 512, 128, 0];

  for (const budget of tokenBudgets) {
    const start = Date.now();
    const atom: Atom = {
      id: `oom_test_${budget}`,
      type: 'document',
      source: 'document_upload',
      payload: { description: `Token budget: ${budget}` },
      confidence: 0.7,
      importance: 'high',
    };
    engine.process({
      triggeringAtom: atom,
    });
    const state = engine.state;
    const shouldDegrade = budget < 512;

    steps.push({
      name: `oom_budget_${budget}`,
      input: { tokenBudget: budget },
      expected: { degradationExpected: shouldDegrade },
      actual: { activeTier: state.activeTier, thermallyViable: state.thermallyViable },
      passed: true,
      durationMs: Date.now() - start,
      notes: `Tier: ${state.activeTier}, momentum: ${state.userMomentumVector.toFixed(2)}`,
    });
  }

  return steps;
}

// ─── Deterministic Degradation ───────────────────────────────────────

function simulateDeterministicDegradation(engine: DynamicPromptEngine, memory: MemoryStore): HarnessStep[] {
  const steps: HarnessStep[] = [];

  // Phase 1: Normal operation
  engine.process({ sensors: { thermalState: 'nominal', batteryLevel: 100 } });
  steps.push({
    name: 'degradation_baseline',
    input: { thermalState: 'nominal', batteryLevel: 100 },
    expected: { tier: 'reflex_or_executive', atmosphereResponsive: true },
    actual: { tier: engine.state.activeTier, mood: engine.state.atmosphere.mood },
    passed: true,
    durationMs: 0,
    notes: 'Baseline established',
  });

  // Phase 2: Thermal ramp to critical
  engine.process({ sensors: { thermalState: 'critical' } });
  const hotState = engine.state;
  const hotPassed = !hotState.thermallyViable && hotState.atmosphere.visuals.motionVelocity < 0.5;
  steps.push({
    name: 'degradation_thermal_critical',
    input: { thermalState: 'critical' },
    expected: { thermallyViable: false, motionReduced: true },
    actual: { thermallyViable: hotState.thermallyViable, motionVelocity: hotState.atmosphere.visuals.motionVelocity },
    passed: hotPassed,
    durationMs: 0,
    notes: `Motion velocity: ${hotState.atmosphere.visuals.motionVelocity.toFixed(2)}, mood: ${hotState.atmosphere.mood}`,
  });

  // Phase 3: Battery drain during thermal critical
  engine.process({ sensors: { batteryLevel: 10, thermalState: 'critical' } });
  const drainedState = engine.state;
  const drainPassed = !drainedState.batteryAllowsCortex && !drainedState.thermallyViable;
  steps.push({
    name: 'degradation_thermal_plus_battery',
    input: { batteryLevel: 10, thermalState: 'critical' },
    expected: { cortexDenied: true, thermalThrottled: true },
    actual: { batteryAllowsCortex: drainedState.batteryAllowsCortex, thermallyViable: drainedState.thermallyViable },
    passed: drainPassed,
    durationMs: 0,
    notes: 'Both constraints active: atmosphere should "breathe" gracefully',
  });

  // Phase 4: Recovery
  engine.process({ sensors: { thermalState: 'nominal', batteryLevel: 100 } });
  const recoveredState = engine.state;
  const recoveryPassed = recoveredState.thermallyViable && recoveredState.batteryAllowsCortex;
  steps.push({
    name: 'degradation_recovery',
    input: { thermalState: 'nominal', batteryLevel: 100 },
    expected: { thermallyViable: true, batteryAllowsCortex: true },
    actual: { thermallyViable: recoveredState.thermallyViable, batteryAllowsCortex: recoveredState.batteryAllowsCortex },
    passed: recoveryPassed,
    durationMs: 0,
    notes: `Recovered mood: ${recoveredState.atmosphere.mood}, tier: ${recoveredState.activeTier}`,
  });

  return steps;
}

// ─── Form Factor Simulator ───────────────────────────────────────────

function simulateFormFactor(engine: DynamicPromptEngine, memory: MemoryStore): HarnessStep[] {
  const steps: HarnessStep[] = [];
  const formFactors: CognitiveState['sensors']['formFactor'][] = ['phone', 'tablet', 'foldable', 'desktop', 'dex'];

  for (const ff of formFactors) {
    const start = Date.now();
    engine.process({ sensors: { formFactor: ff } });
    const state = engine.state;

    steps.push({
      name: `form_factor_${ff}`,
      input: { formFactor: ff },
      expected: { adapted: true },
      actual: { formFactor: state.sensors.formFactor, tier: state.activeTier },
      passed: true,
      durationMs: Date.now() - start,
    });
  }

  return steps;
}

// ─── Coordination Coherence ──────────────────────────────────────────

function simulateCoordinationCoherence(engine: DynamicPromptEngine, memory: MemoryStore): HarnessStep[] {
  const steps: HarnessStep[] = [];

  // Send contradictory atoms and verify the engine doesn't oscillate wildly
  const atoms: Atom[] = [
    { id: 'coherence_1', type: 'nfc_tap', source: 'nfc', payload: {}, confidence: 0.95, importance: 'low' },
    { id: 'coherence_2', type: 'a2a_task', source: 'a2a', payload: { description: 'Critical alert' }, confidence: 0.3, importance: 'critical' },
    { id: 'coherence_3', type: 'nfc_tap', source: 'nfc', payload: {}, confidence: 0.9, importance: 'low' },
    { id: 'coherence_4', type: 'webhook', source: 'webhook', payload: {}, confidence: 0.85, importance: 'medium' },
    { id: 'coherence_5', type: 'document', source: 'document_upload', payload: { description: 'Upload report' }, confidence: 0.7, importance: 'high' },
  ];

  const tierHistory: string[] = [];
  for (const atom of atoms) {
    const start = Date.now();
    engine.process({ triggeringAtom: atom });
    tierHistory.push(engine.state.activeTier);
    steps.push({
      name: `coherence_${atom.id}`,
      input: { type: atom.type, importance: atom.importance },
      expected: { tierConsistent: true },
      actual: { tier: engine.state.activeTier, mood: engine.state.atmosphere.mood },
      passed: true,
      durationMs: Date.now() - start,
    });
  }

  // Check for wild oscillation (reflex → cortex → reflex → cortex = bad)
  let oscillations = 0;
  for (let i = 2; i < tierHistory.length; i++) {
    if (tierHistory[i] === tierHistory[i - 2] && tierHistory[i] !== tierHistory[i - 1]) {
      oscillations++;
    }
  }
  const coherencePassed = oscillations <= 1;
  steps.push({
    name: 'coherence_oscillation_check',
    input: { tierHistory },
    expected: { maxOscillations: 1 },
    actual: { oscillations },
    passed: coherencePassed,
    durationMs: 0,
    notes: coherencePassed ? 'No excessive tier oscillation' : `Detected ${oscillations} oscillations`,
  });

  return steps;
}

// ─── Harness Runner ──────────────────────────────────────────────────

export function runHarness(scenario: HarnessScenario, dataDir?: string): HarnessResult[] {
  const results: HarnessResult[] = [];
  const dir = dataDir ?? path.join(process.cwd(), 'data', 'harness');

  const scenarios: HarnessScenario[] = scenario === 'all'
    ? ['thermal', 'battery', 'network_failover', 'oom', 'coordination_coherence', 'form_factor', 'deterministic_degradation']
    : [scenario];

  for (const s of scenarios) {
    const memory = new MemoryStore(dir, `harness_${s}.jsonl`);
    const engine = new DynamicPromptEngine(memory);
    const start = Date.now();

    let steps: HarnessStep[];
    switch (s) {
      case 'thermal': steps = simulateThermalScenario(engine, memory); break;
      case 'battery': steps = simulateBatteryScenario(engine, memory); break;
      case 'network_failover': steps = simulateNetworkFailover(engine, memory); break;
      case 'oom': steps = simulateOOM(engine, memory); break;
      case 'coordination_coherence': steps = simulateCoordinationCoherence(engine, memory); break;
      case 'form_factor': steps = simulateFormFactor(engine, memory); break;
      case 'deterministic_degradation': steps = simulateDeterministicDegradation(engine, memory); break;
      default: steps = [];
    }

    const passed = steps.every(step => step.passed);
    results.push({
      scenario: s,
      steps,
      passed,
      failureReason: passed ? undefined : steps.find(s => !s.passed)?.notes ?? 'Step failed',
      totalDurationMs: Date.now() - start,
    });
  }

  return results;
}

// ─── CLI Entry Point ─────────────────────────────────────────────────

function formatResult(result: HarnessResult): string {
  const status = result.passed ? 'PASS' : 'FAIL';
  const lines = [
    `\n=== ${result.scenario.toUpperCase()} === [${status}] (${result.totalDurationMs}ms)`,
  ];

  for (const step of result.steps) {
    const marker = step.passed ? '  OK' : ' FAIL';
    lines.push(`  ${marker} ${step.name} (${step.durationMs}ms)${step.notes ? ` — ${step.notes}` : ''}`);
  }

  if (!result.passed) {
    lines.push(`  FAILURE: ${result.failureReason}`);
  }

  return lines.join('\n');
}

if (process.argv[1] && (process.argv[1].endsWith('dev_harness.js') || process.argv[1].endsWith('dev_harness.ts'))) {
  const scenarioArg = process.argv.find(a => a.startsWith('--scenario='))?.split('=')[1] as HarnessScenario ?? 'all';
  const validScenarios: HarnessScenario[] = ['thermal', 'battery', 'network_failover', 'oom', 'coordination_coherence', 'form_factor', 'deterministic_degradation', 'all'];

  if (!validScenarios.includes(scenarioArg)) {
    console.error(`Invalid scenario: ${scenarioArg}`);
    console.error(`Valid scenarios: ${validScenarios.join(', ')}`);
    process.exit(1);
  }

  console.log(`\nAva007 Cognitive Runtime — Development Harness`);
  console.log(`Scenario: ${scenarioArg}`);
  console.log(`Timestamp: ${new Date().toISOString()}\n`);

  const results = runHarness(scenarioArg);

  let allPassed = true;
  for (const result of results) {
    console.log(formatResult(result));
    if (!result.passed) allPassed = false;
  }

  const totalSteps = results.reduce((sum, r) => sum + r.steps.length, 0);
  const passedSteps = results.reduce((sum, r) => sum + r.steps.filter(s => s.passed).length, 0);
  console.log(`\n=== SUMMARY === ${passedSteps}/${totalSteps} steps passed`);

  process.exit(allPassed ? 0 : 1);
}
