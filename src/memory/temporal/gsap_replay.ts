/**
 * L3 – GSAP Temporal Reconstructor
 * Treats GSAP timelines as Deterministic Temporal Memory Graphs.
 * Allows the system to "scrub" to specific cognitive coordinates
 * and reconstruct frame-accurate AI state from Tashi signatures.
 *
 * This module augments (does not replace) TemporalReplay in ./replay.ts.
 * TemporalReplay handles JSONL projection; this module handles GSAP
 * timeline scrubbing, superposition observation, and velocity mapping.
 */
import { CavernBridge, type MPEGHProfile } from '../../integrations/audio/cavern_bridge.js';
import { MemoryStore, type MemoryEntry } from '../jsonl/index.js';

// ─── Types ───────────────────────────────────────────────────────────

export interface SuperpositionBranch {
  id: string;
  timelineId: string;
  probability: number;
  collapsed: boolean;
  observedAt: string | null;
}

export interface CognitiveCoordinate {
  seq: number;
  timestamp: number;   // seconds on the master timeline
  layer: number;
  eventType: string;
}

export interface ReplayState {
  coordinate: CognitiveCoordinate;
  superposition: SuperpositionBranch | null;
  mpegHProfile: MPEGHProfile | null;
  reconstructedPayload: unknown;
}

// ─── GSAP Temporal Reconstructor ─────────────────────────────────────

export class GSAPTemporalReconstructor {
  private superpositions: Map<string, SuperpositionBranch> = new Map();
  private masterTimeline: any = null; // GSAP TimelineMax / TimelineLite (loaded at runtime)
  private cavernBridge: CavernBridge;
  private store: MemoryStore;

  constructor(store: MemoryStore, cavernBridge: CavernBridge) {
    this.store = store;
    this.cavernBridge = cavernBridge;
  }

  /**
   * Attach a GSAP timeline instance.
   * Call this after GSAP is loaded (e.g., via dynamic import or CDN).
   */
  attachTimeline(timelineInstance: any): void {
    this.masterTimeline = timelineInstance;
  }

  /**
   * Scrub the master ticker to a retrieved memory coordinate.
   * Reconstructs the frame-accurate AI state from a Tashi signature.
   */
  scrubToCoordinate(coordinate: CognitiveCoordinate): ReplayState | null {
    if (!this.masterTimeline) {
      console.warn('[GSAPReplay] No timeline attached — returning reconstructed memory only.');
      return this.reconstructFromMemory(coordinate);
    }

    console.log(`[GSAPReplay] Scrubbing playhead to T: ${coordinate.timestamp}s`);

    // Deterministic replay: scrub to the coordinate
    this.masterTimeline.pause().time(coordinate.timestamp);

    // Observation collapse: evaluate superposition branches at the target frame
    const activeSuperposition = this.observeActiveSuperposition();

    // Velocity mapping for spatial audio synchronization
    const velocity = this.extractVelocity();
    this.cavernBridge.setVelocity(velocity);
    const mpegHProfile = this.cavernBridge.getCurrentProfile();

    // Record the replay event
    this.store.append(3, 'gsap_replay', {
      coordinate,
      superposition: activeSuperposition?.id ?? null,
      velocity,
    });

    return {
      coordinate,
      superposition: activeSuperposition,
      mpegHProfile,
      reconstructedPayload: this.reconstructPayload(coordinate),
    };
  }

  /**
   * Register a superposition branch on the timeline.
   * Branches represent alternative cognitive states that collapse on observation.
   */
  registerSuperposition(branch: SuperpositionBranch): void {
    this.superpositions.set(branch.id, branch);
    this.store.append(3, 'superposition_register', {
      branchId: branch.id,
      timelineId: branch.timelineId,
      probability: branch.probability,
    });
  }

  /**
   * Observe (collapse) a superposition branch.
   * After observation, the branch is marked as collapsed.
   */
  observeSuperposition(branchId: string): SuperpositionBranch | null {
    const branch = this.superpositions.get(branchId);
    if (!branch) return null;
    branch.collapsed = true;
    branch.observedAt = new Date().toISOString();
    this.store.append(3, 'superposition_observe', {
      branchId,
      observedAt: branch.observedAt,
    });
    return branch;
  }

  // ─── Private helpers ───────────────────────────────────────────────

  private observeActiveSuperposition(): SuperpositionBranch | null {
    for (const [, branch] of this.superpositions) {
      if (!branch.collapsed) {
        return this.observeSuperposition(branch.id);
      }
    }
    return null;
  }

  private extractVelocity(): number {
    if (!this.masterTimeline) return 0;
    try {
      const children = this.masterTimeline.getChildren?.();
      if (children && children.length > 0) {
        const progress = this.masterTimeline.progress?.() ?? 0;
        return Math.min(2, progress * 2);
      }
    } catch {
      // GSAP API may not be available in all environments
    }
    return 0;
  }

  private reconstructFromMemory(coordinate: CognitiveCoordinate): ReplayState {
    const payload = this.reconstructPayload(coordinate);
    return {
      coordinate,
      superposition: null,
      mpegHProfile: null,
      reconstructedPayload: payload,
    };
  }

  private reconstructPayload(coordinate: CognitiveCoordinate): unknown {
    const entries = this.store.readRange(coordinate.seq, coordinate.seq);
    return entries.length > 0 ? entries[0].payload : null;
  }

  /**
   * Find a cognitive coordinate by event type and approximate timestamp.
   */
  findCoordinate(eventType: string, nearTimestamp: number): CognitiveCoordinate | null {
    const entries = this.store.readAll();
    let best: MemoryEntry | null = null;
    let bestDelta = Infinity;

    for (const e of entries) {
      const eventKey = `${e.layer}:${e.type}`;
      if (eventKey !== eventType) continue;
      const entryTs = new Date(e.ts).getTime() / 1000;
      const delta = Math.abs(entryTs - nearTimestamp);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = e;
      }
    }

    if (!best) return null;
    return {
      seq: best.seq,
      timestamp: new Date(best.ts).getTime() / 1000,
      layer: best.layer,
      eventType: best.type,
    };
  }
}
