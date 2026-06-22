/**
 * PolicyStore — DuckDB-backed routing policy store.
 *
 * Policies are loaded once at startup (or on `reload()`) from the
 * DuckDB governance store. They shape Constellation routing decisions
 * without modifying the Router's core algorithm.
 */

export interface RoutingPolicy {
  id: string;
  kind: 'force_local' | 'budget_cap' | 'prefer_backend' | 'disable_backend' | 'task_routing';
  /** Optional pillar/operation filter */
  pillar?: string;
  operation?: string;
  /** Policy-specific parameters */
  params: Record<string, unknown>;
  reason: string;
}

export class PolicyStore {
  private policies: RoutingPolicy[] = [];

  /** Load policies from DuckDB governance store. Stub: returns empty list. */
  async load(): Promise<void> {
    // TODO: query DuckDB governance.duckdb for routing_policies table
    // For now, register a sensible default
    this.policies = [
      {
        id: 'default-force-local-reflex',
        kind: 'force_local',
        pillar: 'rev_ike',
        operation: 'reflex',
        params: {},
        reason: 'REV.IKE reflex must always run locally for sub-20ms latency',
      },
      {
        id: 'default-budget-cap',
        kind: 'budget_cap',
        params: {
          budget: { maxLatencyMs: 5000, maxBatteryPct: 5, maxCostUsd: 0.10 },
        },
        reason: 'Per-session budget cap to prevent runaway costs',
      },
    ];
  }

  list(): RoutingPolicy[] {
    return [...this.policies];
  }

  reload(): Promise<void> {
    return this.load();
  }
}
