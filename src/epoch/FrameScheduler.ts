/**
 * FrameScheduler — 60fps frame scheduler for AMOS.
 *
 * Coordinates animation frame requests across all EPOCH components so
 * that we have a single rAF loop (instead of one per component). This
 * is critical on mobile — multiple rAF loops cause jank.
 *
 * Uses requestAnimationFrame in browser, falls back to setTimeout(0)
 * in Node/test environments.
 */

export type FrameCallback = (deltaMs: number, elapsedMs: number) => void;

export class FrameScheduler {
  private callbacks: Set<FrameCallback> = new Set();
  private running = false;
  private lastFrameTime = 0;
  private startTime = 0;
  private rafId: number | null = null;
  private raf: ((cb: (t: number) => void) => number) | null = null;
  private caf: ((id: number) => void) | null = null;

  constructor() {
    if (typeof requestAnimationFrame === 'function') {
      this.raf = requestAnimationFrame;
      this.caf = cancelAnimationFrame;
    } else {
      // Node fallback — emulate rAF with setTimeout
      this.raf = (cb) => setTimeout(() => cb(Date.now()), 16) as unknown as number;
      this.caf = (id) => clearTimeout(id);
    }
  }

  /** Register a frame callback. Returns an unsubscribe function. */
  subscribe(cb: FrameCallback): () => void {
    this.callbacks.add(cb);
    if (!this.running) this.start();
    return () => {
      this.callbacks.delete(cb);
      if (this.callbacks.size === 0) this.stop();
    };
  }

  /** Start the scheduler. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.startTime = performanceNow();
    this.lastFrameTime = this.startTime;
    this.tick(this.startTime);
  }

  /** Stop the scheduler. */
  stop(): void {
    this.running = false;
    if (this.rafId !== null && this.caf) {
      this.caf(this.rafId);
      this.rafId = null;
    }
  }

  /** Number of currently-registered callbacks. */
  size(): number {
    return this.callbacks.size;
  }

  private tick = (now: number): void => {
    if (!this.running) return;
    const delta = now - this.lastFrameTime;
    const elapsed = now - this.startTime;
    this.lastFrameTime = now;
    // Iterate over a copy so callbacks can unsubscribe during iteration
    for (const cb of Array.from(this.callbacks)) {
      try {
        cb(delta, elapsed);
      } catch (e) {
        console.error('[FrameScheduler] callback threw:', e);
      }
    }
    if (this.running && this.raf) {
      this.rafId = this.raf(this.tick);
    }
  };
}

function performanceNow(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}
