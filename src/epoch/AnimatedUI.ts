/**
 * AnimatedUI — GSAP animation orchestrator.
 *
 * Wraps GSAP timeline creation behind a typed API so the rest of the
 * codebase doesn't depend on GSAP directly. All animations are routed
 * through Meta Harness for governance.
 *
 * Real implementation requires `gsap` npm package. This module lazily
 * imports it so the rest of the type-checks pass even without GSAP
 * installed.
 */

import type { FrameScheduler } from './FrameScheduler';

export interface AnimationSpec {
  /** Target element selector or ref */
  target: string | HTMLElement;
  /** GSAP vars object — passed verbatim to gsap.to() / from() / fromTo() */
  vars: Record<string, unknown>;
  /** Optional duration in seconds (overrides vars.duration) */
  duration?: number;
  /** Optional delay in seconds */
  delay?: number;
  /** Optional label for timeline positioning */
  label?: string;
}

export interface UITimeline {
  /** Play the timeline */
  play(): void;
  /** Pause */
  pause(): void;
  /** Seek to a specific time */
  seek(time: number): void;
  /** Total duration in seconds */
  duration(): number;
  /** Clean up (kill the timeline) */
  kill(): void;
}

export class AnimatedUI {
  private scheduler: FrameScheduler | null = null;
  private gsapModule: typeof import('gsap') | null = null;
  private activeTimelines: Set<UITimeline> = new Set();

  async init(scheduler: FrameScheduler): Promise<void> {
    this.scheduler = scheduler;
    // Lazy-load GSAP so this file is importable even before npm install
    this.gsapModule = (await import('gsap')).default ?? (await import('gsap'));
  }

  /** Create a timeline from a list of specs. */
  timeline(specs: AnimationSpec[]): UITimeline {
    if (!this.gsapModule) {
      throw new Error('AnimatedUI not initialized — call init() first');
    }
    const gsap = this.gsapModule;
    const tl = gsap.timeline();
    for (const spec of specs) {
      const target = typeof spec.target === 'string'
        ? document.querySelector(spec.target)
        : spec.target;
      if (!target) continue;
      const vars = { ...spec.vars };
      if (spec.duration !== undefined) vars.duration = spec.duration;
      if (spec.delay !== undefined) vars.delay = spec.delay;
      if (spec.label) {
        tl.to(target, vars, spec.label);
      } else {
        tl.to(target, vars);
      }
    }
    const wrapper: UITimeline = {
      play: () => tl.play(),
      pause: () => tl.pause(),
      seek: (t) => tl.seek(t),
      duration: () => tl.duration(),
      kill: () => {
        tl.kill();
        this.activeTimelines.delete(wrapper);
      },
    };
    this.activeTimelines.add(wrapper);
    return wrapper;
  }

  /** Kill all active timelines (e.g. on route change). */
  killAll(): void {
    for (const tl of this.activeTimelines) tl.kill();
    this.activeTimelines.clear();
  }
}
