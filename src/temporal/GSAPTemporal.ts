/**
 * GSAPTemporal — Injection-centric temporal substrate.
 *
 * Phase 6 — GSAP temporal engine.
 *
 * Per AMOS v2.8 §4: AVA007 is injection-first. The primary operation is
 * insertIntelligence() which mutates the state manifold. The GSAP timeline
 * is the deterministic AUDIT TRAIL of those injections, not the driver.
 *
 * Operations:
 *   - insertIntelligence(target, vars): PRIMARY — mutates state, records to timeline
 *   - recallState(t): SECONDARY — reconstructs state at time t from audit trail
 *   - getTimeline(): Returns the full timeline for debugging/replay
 *
 * The timeline is also persisted to the Context Lake (DuckDB) so it
 * survives page refreshes.
 */

export interface IntelligenceVars {
  value?: unknown;
  text?: string;
  duration?: number;
  ease?: string;
  metadata?: Record<string, unknown>;
}

export interface TimelineEntry {
  id: string;
  target: string;
  vars: IntelligenceVars;
  timestamp: number;
  session_id: string | null;
}

class GSAPTemporalEngine {
  private timeline: TimelineEntry[] = [];
  private state: Map<string, unknown> = new Map();
  private startTime: number = Date.now();
  private sessionId: string | null = null;

  setSession(id: string | null) {
    this.sessionId = id;
  }

  /**
   * PRIMARY OPERATION: Mutate the state manifold.
   * This is the core of AVA007's cognitive runtime.
   *
   * Every decision, perception, and action flows through here.
   * The timeline is updated as a SIDE EFFECT (audit trail).
   *
   * @param target The state key to mutate (e.g., 'quote.price', 'user.input')
   * @param vars The new value + animation metadata
   * @returns The timeline entry (audit receipt)
   */
  insertIntelligence(target: string, vars: IntelligenceVars): TimelineEntry {
    const entry: TimelineEntry = {
      id: `intel_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      target,
      vars,
      timestamp: Date.now(),
      session_id: this.sessionId,
    };

    // Mutate state
    this.state.set(target, vars.value ?? vars.text);

    // Append to timeline (audit trail)
    this.timeline.push(entry);

    // Log for debugging
    console.log(`[temporal] insertIntelligence: ${target} = ${JSON.stringify(vars.value ?? vars.text).slice(0, 100)}`);

    return entry;
  }

  /**
   * SECONDARY OPERATION: Reconstruct state at a given time.
   * Replays all insertIntelligence calls up to time t.
   *
   * @param t Timestamp (ms since epoch). Default: now.
   * @returns A snapshot of the state manifold at time t.
   */
  recallState(t: number = Date.now()): Map<string, unknown> {
    const snapshot = new Map<string, unknown>();

    // Replay all entries up to time t
    for (const entry of this.timeline) {
      if (entry.timestamp <= t) {
        snapshot.set(entry.target, entry.vars.value ?? entry.vars.text);
      }
    }

    return snapshot;
  }

  /**
   * Get the full timeline (audit trail).
   */
  getTimeline(): TimelineEntry[] {
    return [...this.timeline];
  }

  /**
   * Get recent timeline entries.
   */
  getRecentEntries(limit: number = 20): TimelineEntry[] {
    return this.timeline.slice(-limit);
  }

  /**
   * Get current state (live, not reconstructed).
   */
  getCurrentState(): Map<string, unknown> {
    return new Map(this.state);
  }

  /**
   * Get a specific state value.
   */
  getState(target: string): unknown | undefined {
    return this.state.get(target);
  }

  /**
   * Get elapsed time since engine start.
   */
  getElapsedMs(): number {
    return Date.now() - this.startTime;
  }

  /**
   * Clear timeline (for testing).
   */
  clear(): void {
    this.timeline = [];
    this.state.clear();
    this.startTime = Date.now();
  }

  /**
   * Export timeline as JSON for persistence.
   */
  exportTimeline(): string {
    return JSON.stringify(this.timeline);
  }

  /**
   * Import timeline from JSON (for restoring after page refresh).
   */
  importTimeline(json: string): void {
    try {
      const entries = JSON.parse(json) as TimelineEntry[];
      this.timeline = entries;
      // Rebuild state from timeline
      this.state.clear();
      for (const entry of entries) {
        this.state.set(entry.target, entry.vars.value ?? entry.vars.text);
      }
    } catch {
      console.error('[temporal] Failed to import timeline');
    }
  }
}

/** Singleton instance. */
let _instance: GSAPTemporalEngine | null = null;

export function getTemporalEngine(): GSAPTemporalEngine {
  if (!_instance) {
    _instance = new GSAPTemporalEngine();
  }
  return _instance;
}
