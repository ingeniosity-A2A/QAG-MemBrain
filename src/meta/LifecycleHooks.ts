/**
 * LifecycleHooks — PRISM-style lifecycle interceptors.
 *
 * Allows registering callbacks at well-defined phases of the AMOS
 * runtime lifecycle. Used for:
 *   - Ingress: transform incoming user input before AVA007 sees it
 *   - Tool execution: wrap GOOSE tool calls with pre/post hooks
 *   - State persistence: snapshot state to TASHI before/after mutations
 *   - Egress: transform final response before sending to UI
 *
 * Hooks run in registration order. A hook may veto by returning false
 * (for pre-hooks) or modify the value (for transform-hooks).
 */

export type LifecyclePhase =
  | 'ingress'           // Before AVA007 receives user input
  | 'pre_tool'          // Before GOOSE executes a tool
  | 'post_tool'         // After GOOSE executes a tool
  | 'pre_state_mutate'  // Before TASHI state mutation
  | 'post_state_mutate' // After TASHI state mutation
  | 'egress';           // Before final response is sent to UI

export interface LifecycleContext {
  /** What phase we're in */
  phase: LifecyclePhase;
  /** The value being passed through (may be modified by transform hooks) */
  value: unknown;
  /** Per-phase metadata */
  metadata: Record<string, unknown>;
  /** Session ID */
  sessionId?: string;
  /** Trace ID for cross-cutting audit */
  traceId?: string;
}

export type LifecycleHook = (ctx: LifecycleContext) => Promise<LifecycleContext | false>;

export class LifecycleHooks {
  private hooks: Map<LifecyclePhase, LifecycleHook[]> = new Map();

  /** Register a hook for a given phase. Returns an unsubscribe function. */
  register(phase: LifecyclePhase, hook: LifecycleHook): () => void {
    const list = this.hooks.get(phase) ?? [];
    list.push(hook);
    this.hooks.set(phase, list);
    return () => {
      const arr = this.hooks.get(phase);
      if (!arr) return;
      const idx = arr.indexOf(hook);
      if (idx >= 0) arr.splice(idx, 1);
    };
  }

  /** Run all hooks for a phase in sequence. */
  async run(ctx: LifecycleContext): Promise<LifecycleContext> {
    const list = this.hooks.get(ctx.phase) ?? [];
    let current = ctx;
    for (const hook of list) {
      const result = await hook(current);
      if (result === false) {
        // Hook vetoed — return current context but mark as vetoed
        return { ...current, metadata: { ...current.metadata, __vetoed__: true } };
      }
      current = result;
    }
    return current;
  }

  /** Check if any hook vetoed in the last run. */
  wasVetoed(ctx: LifecycleContext): boolean {
    return ctx.metadata.__vetoed__ === true;
  }

  /** Remove all hooks for a phase (or all phases if none specified). */
  clear(phase?: LifecyclePhase): void {
    if (phase) {
      this.hooks.delete(phase);
    } else {
      this.hooks.clear();
    }
  }
}
