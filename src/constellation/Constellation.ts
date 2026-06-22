/**
 * Constellation — singleton facade for the model routing layer.
 *
 * Wires together Router, BackendRegistry, BudgetCalculator, HealthChecker,
 * and PolicyStore.
 */

import { Router, type RoutingRequest, type RoutingDecision } from './Router';
import { BackendRegistry } from './BackendRegistry';
import { BudgetCalculator } from './BudgetCalculator';
import { HealthChecker } from './HealthChecker';
import { PolicyStore } from './PolicyStore';

export class Constellation {
  public readonly router: Router;
  public readonly backends: BackendRegistry;
  public readonly budget: BudgetCalculator;
  public readonly health: HealthChecker;
  public readonly policies: PolicyStore;

  private constructor() {
    this.backends = new BackendRegistry();
    this.health = new HealthChecker();
    this.budget = new BudgetCalculator();
    this.policies = new PolicyStore();
    this.router = new Router(this.backends, this.budget, this.health, this.policies);
  }

  private static instance: Constellation | null = null;

  static create(): Constellation {
    if (!Constellation.instance) {
      Constellation.instance = new Constellation();
    }
    return Constellation.instance;
  }

  /** Primary entry point. */
  async route(req: RoutingRequest): Promise<RoutingDecision> {
    return this.router.route(req);
  }
}
