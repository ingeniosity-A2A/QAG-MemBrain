/**
 * QAG-MemBrain GSAP Temporal Synchronization Layer (LAYER 5)
 * Ava007 Cognitive Runtime
 *
 * Deterministic GSAP-compatible timeline engine for cognitive temporal memory.
 * Provides lifecycle management, superposition observation/collapse, and
 * cognitive epoch recording with SHA-256 audit hashing.
 *
 * No external GSAP dependency — implements a lightweight, GSAP-API-compatible
 * timeline engine using only Node.js built-ins (crypto, events).
 *
 * ESM module — works with Node.js (type: module) and browser <script type="module">
 */

// ── Environment-safe imports ──────────────────────────────────────────
let crypto;
let EventEmitter;

try {
  crypto = await import('node:crypto');
  crypto = crypto.default || crypto;
} catch (_e) {
  crypto = null;
}

try {
  const events = await import('node:events');
  EventEmitter = events.EventEmitter;
} catch (_e) {
  EventEmitter = null;
}

// ── SHA-256 helper (works in Node & browser) ─────────────────────────
async function sha256Hex(input) {
  if (crypto && typeof crypto.createHash === 'function') {
    // Node.js path — synchronous
    return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
  }
  // Browser path — Web Crypto API
  if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(input);
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
  // Final fallback
  return sha256HexSync(input);
}

// Synchronous SHA-256 for Node.js environments (used in recordEpoch)
function sha256HexSync(input) {
  if (crypto && typeof crypto.createHash === 'function') {
    return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
  }
  // Fallback: deterministic hash for environments without crypto
  // (not cryptographically secure, but consistent for audit)
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hex1 = (h2 >>> 0).toString(16).padStart(8, '0');
  const hex2 = (h1 >>> 0).toString(16).padStart(8, '0');
  // Repeat to fill 64 hex chars (256 bits)
  return (hex1 + hex2 + hex1 + hex2 + hex1 + hex2 + hex1 + hex2);
}

// ── Tween Engine ──────────────────────────────────────────────────────
class Tween {
  constructor(id, target, vars, position, duration) {
    this.id = id;
    this.target = target;          // reference to target object
    this.vars = vars;              // { prop: endValue, duration, ease, ... }
    this.position = position;      // start time in seconds on the timeline
    this.duration = duration;      // tween duration in seconds
    this.startTime = position;
    this.endTime = position + duration;
    this.ease = vars.ease || 'linear';
    this.props = {};
    this.initialValues = {};

    // Extract animatable properties (exclude GSAP-reserved keys)
    const reserved = new Set([
      'duration', 'ease', 'onStart', 'onUpdate', 'onComplete',
      'delay', 'repeat', 'yoyo', 'onReverseComplete',
    ]);
    for (const key of Object.keys(vars)) {
      if (!reserved.has(key)) {
        this.props[key] = vars[key];
      }
    }

    // Cache initial values from target
    if (target && typeof target === 'object') {
      for (const key of Object.keys(this.props)) {
        this.initialValues[key] = target[key] !== undefined ? target[key] : 0;
      }
    }
  }

  /**
   * Compute eased progress using common easing functions.
   */
  _easeProgress(t) {
    switch (this.ease) {
      case 'linear': return t;
      case 'power1':
      case 'easeIn': return t * t;
      case 'power2': return t * t * t;
      case 'power3': return t * t * t * t;
      case 'power4': return t * t * t * t * t;
      case 'easeOut': return 1 - (1 - t) * (1 - t);
      case 'easeInOut': return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      case 'back': {
        const s = 1.70158;
        return t * t * ((s + 1) * t - s);
      }
      case 'elastic': {
        if (t === 0 || t === 1) return t;
        return -Math.pow(2, 10 * (t - 1)) * Math.sin((t - 1.075) * 2 * Math.PI / 0.3);
      }
      case 'bounce': {
        if (t < 1 / 2.75) {
          return 7.5625 * t * t;
        } else if (t < 2 / 2.75) {
          const t2 = t - 1.5 / 2.75;
          return 7.5625 * t2 * t2 + 0.75;
        } else if (t < 2.5 / 2.75) {
          const t2 = t - 2.25 / 2.75;
          return 7.5625 * t2 * t2 + 0.9375;
        } else {
          const t2 = t - 2.625 / 2.75;
          return 7.5625 * t2 * t2 + 0.984375;
        }
      }
      default: return t; // unknown ease → linear
    }
  }

  /**
   * Evaluate tween state at a given timeline time.
   * Returns { prop: value } for each animated property, or null if not active.
   */
  evaluateAt(time) {
    if (time < this.startTime || time > this.endTime) {
      return null;
    }

    const rawProgress = this.duration > 0
      ? Math.min(1, Math.max(0, (time - this.startTime) / this.duration))
      : 1;

    const progress = this._easeProgress(rawProgress);
    const state = {};

    for (const key of Object.keys(this.props)) {
      const start = this.initialValues[key] !== undefined ? this.initialValues[key] : 0;
      const end = this.props[key];
      if (typeof end === 'number' && typeof start === 'number') {
        state[key] = start + (end - start) * progress;
      } else {
        state[key] = rawProgress >= 1 ? end : start;
      }
    }

    return state;
  }

  /**
   * Apply computed state to the target object.
   */
  applyAt(time) {
    const state = this.evaluateAt(time);
    if (state && this.target && typeof this.target === 'object') {
      for (const key of Object.keys(state)) {
        this.target[key] = state[key];
      }
    }
    return state;
  }

  /**
   * Compute instantaneous velocity for each property at a given time.
   */
  velocityAt(time, dt = 0.016) {
    const before = this.evaluateAt(time - dt / 2);
    const after = this.evaluateAt(time + dt / 2);
    if (!before || !after) return {};

    const velocity = {};
    for (const key of Object.keys(after)) {
      if (typeof after[key] === 'number' && typeof before[key] === 'number') {
        velocity[key] = (after[key] - before[key]) / dt;
      }
    }
    return velocity;
  }
}

// ── Timeline Handle ───────────────────────────────────────────────────
class TimelineHandle {
  constructor(id, config = {}) {
    this.id = id;
    this.duration = 0;
    this.tweens = [];
    this.superpositions = new Map();
    this.epochs = [];
    this.state = 'idle';              // 'idle' | 'playing' | 'paused'
    this.playhead = 0;                // current playhead position in seconds
    this.config = config;
    this._tweenIdCounter = 0;
    this._lastTickTime = null;
    this._tickInterval = null;
  }
}

// ── Main Engine ───────────────────────────────────────────────────────
class GSAPTemporalSync {
  /**
   * @param {object} options
   * @param {number} options.maxDepth     — Maximum superposition nesting depth (default: 5)
   * @param {number} options.tickRate     — Playback tick rate in Hz (default: 60)
   * @param {boolean} options.autoRecord  — Auto-record epoch on state change (default: true)
   */
  constructor(options = {}) {
    this.maxDepth = options.maxDepth || 5;
    this.tickRate = options.tickRate || 60;
    this.autoRecord = options.autoRecord !== undefined ? options.autoRecord : true;
    this._timelines = new Map();
    this._epochIdCounter = 0;

    // Compose EventEmitter for event dispatching
    this._emitter = EventEmitter ? new EventEmitter() : null;
    this._listeners = {};  // fallback listener store
  }

  // ── Event helpers ─────────────────────────────────────────────────

  _emit(event, ...args) {
    if (this._emitter) {
      this._emitter.emit(event, ...args);
    }
    // Also fire fallback listeners
    if (this._listeners[event]) {
      for (const fn of this._listeners[event]) {
        fn(...args);
      }
    }
  }

  on(event, fn) {
    if (this._emitter) {
      this._emitter.on(event, fn);
    } else {
      if (!this._listeners[event]) this._listeners[event] = [];
      this._listeners[event].push(fn);
    }
    return this;
  }

  off(event, fn) {
    if (this._emitter) {
      this._emitter.off(event, fn);
    } else if (this._listeners[event]) {
      const idx = this._listeners[event].indexOf(fn);
      if (idx !== -1) this._listeners[event].splice(idx, 1);
    }
    return this;
  }

  // ── Timeline CRUD ─────────────────────────────────────────────────

  /**
   * Create a named timeline with GSAP-compatible API.
   * @param {string} id — Unique timeline identifier
   * @param {object} config — Optional config { duration, repeat, yoyo, ... }
   * @returns {TimelineHandle}
   */
  createTimeline(id, config = {}) {
    if (this._timelines.has(id)) {
      throw new Error(`Timeline '${id}' already exists`);
    }

    const handle = new TimelineHandle(id, config);
    this._timelines.set(id, handle);

    if (this.autoRecord) {
      this.recordEpoch(id, 'timeline:created', { config });
    }

    this._emit('timeline:created', { id });
    return handle;
  }

  /**
   * Destroy a timeline and clean up resources.
   */
  destroyTimeline(id) {
    const handle = this._getTimeline(id);
    this._stopPlayback(handle);
    this._timelines.delete(id);
    this._emit('timeline:destroyed', { id });
  }

  /**
   * Add a tween to a timeline.
   * @param {string} timelineId
   * @param {object} target — The object whose properties will be animated
   * @param {object} vars — Animation vars { prop: endValue, duration, ease, ... }
   * @param {number|string} position — GSAP-style position parameter (seconds or label)
   * @returns {string} tween ID
   */
  addTween(timelineId, target, vars, position) {
    const handle = this._getTimeline(timelineId);

    const duration = vars.duration || 1;
    let posTime;
    if (position === undefined || position === null) {
      posTime = handle.duration;
    } else if (typeof position === 'number') {
      posTime = position;
    } else if (typeof position === 'string') {
      const relMatch = position.match(/^([+-])=\s*([\d.]+)$/);
      if (relMatch) {
        const sign = relMatch[1] === '+' ? 1 : -1;
        const offset = parseFloat(relMatch[2]);
        posTime = handle.playhead + sign * offset;
      } else if (position === '>') {
        posTime = handle.duration;
      } else if (position === '<') {
        posTime = 0;
      } else {
        posTime = parseFloat(position);
        if (isNaN(posTime)) posTime = handle.duration;
      }
    } else {
      posTime = handle.duration;
    }

    const tweenId = `${timelineId}_tween_${handle._tweenIdCounter++}`;
    const tween = new Tween(tweenId, target, vars, posTime, duration);
    handle.tweens.push(tween);

    const tweenEnd = tween.endTime;
    if (tweenEnd > handle.duration) {
      handle.duration = tweenEnd;
    }

    this._emit('tween:added', { timelineId, tweenId, position: posTime });
    return tweenId;
  }

  // ── Playback Control ──────────────────────────────────────────────

  /**
   * Scrub to an exact timestamp on a timeline.
   * @param {string} timelineId
   * @param {number} timestamp — Time in seconds to scrub to
   * @returns {{ timelineId, timestamp, state, superposition, velocity }}
   */
  scrubTo(timelineId, timestamp) {
    const handle = this._getTimeline(timelineId);

    const clampedTime = Math.max(0, Math.min(timestamp, handle.duration));
    handle.playhead = clampedTime;

    const compositeState = {};
    const compositeVelocity = {};

    for (const tween of handle.tweens) {
      const tweenState = tween.applyAt(clampedTime);
      const tweenVel = tween.velocityAt(clampedTime);

      if (tweenState) {
        for (const [key, val] of Object.entries(tweenState)) {
          compositeState[key] = val;
        }
      }
      if (tweenVel) {
        for (const [key, val] of Object.entries(tweenVel)) {
          compositeVelocity[key] = val;
        }
      }
    }

    const activeSuperposition = this._resolveSuperpositionAt(handle, clampedTime);

    const result = {
      timelineId,
      timestamp: clampedTime,
      state: compositeState,
      superposition: activeSuperposition,
      velocity: compositeVelocity,
    };

    this._emit('timeline:scrubbed', result);
    return result;
  }

  /**
   * Pause timeline playback.
   */
  pause(timelineId) {
    const handle = this._getTimeline(timelineId);
    const previousState = handle.state;
    this._stopPlayback(handle);
    handle.state = 'paused';

    if (this.autoRecord && previousState !== 'paused') {
      this.recordEpoch(timelineId, 'timeline:paused', { previousState, playhead: handle.playhead });
    }

    this._emit('timeline:paused', { timelineId, playhead: handle.playhead });
  }

  /**
   * Resume (or start) timeline playback from current playhead.
   */
  resume(timelineId) {
    const handle = this._getTimeline(timelineId);
    const previousState = handle.state;
    handle.state = 'playing';
    this._startPlayback(handle);

    if (this.autoRecord && previousState !== 'playing') {
      this.recordEpoch(timelineId, 'timeline:resumed', { previousState, playhead: handle.playhead });
    }

    this._emit('timeline:resumed', { timelineId, playhead: handle.playhead });
  }

  /**
   * Seek to a specific time without triggering playback.
   */
  seek(timelineId, timestamp) {
    const handle = this._getTimeline(timelineId);
    const clampedTime = Math.max(0, Math.min(timestamp, handle.duration));
    const previousPlayhead = handle.playhead;
    handle.playhead = clampedTime;

    for (const tween of handle.tweens) {
      tween.applyAt(clampedTime);
    }

    this._emit('timeline:seek', { timelineId, from: previousPlayhead, to: clampedTime });
  }

  /**
   * Get current playhead position in seconds.
   */
  getPlayhead(timelineId) {
    const handle = this._getTimeline(timelineId);
    return handle.playhead;
  }

  // ── Superposition Management ──────────────────────────────────────

  /**
   * Register an alternative cognitive state branch on a timeline.
   */
  registerSuperposition(timelineId, branchId, probability) {
    const handle = this._getTimeline(timelineId);

    // Validate probability first (before depth check, so bad input is always caught)
    if (probability < 0 || probability > 1) {
      throw new Error('Probability must be between 0 and 1');
    }

    if (handle.superpositions.size >= this.maxDepth) {
      throw new Error(`Superposition depth limit (${this.maxDepth}) reached for timeline '${timelineId}'`);
    }

    handle.superpositions.set(branchId, {
      branchId,
      probability,
      collapsed: false,
      collapsedAt: null,
      observedState: null,
      registeredAt: handle.playhead,
      depth: handle.superpositions.size,
    });

    this._emit('superposition:registered', { timelineId, branchId, probability });
  }

  /**
   * Observe (collapse) a superposition branch.
   */
  observeSuperposition(timelineId, branchId) {
    const handle = this._getTimeline(timelineId);
    const branch = handle.superpositions.get(branchId);

    if (!branch) {
      throw new Error(`Superposition branch '${branchId}' not found on timeline '${timelineId}'`);
    }

    if (branch.collapsed) {
      throw new Error(`Branch '${branchId}' has already been collapsed at ${branch.collapsedAt}`);
    }

    const scrubResult = this.scrubTo(timelineId, handle.playhead);

    branch.collapsed = true;
    branch.collapsedAt = handle.playhead;
    branch.observedState = scrubResult.state;

    const result = {
      branchId,
      probability: branch.probability,
      collapsedAt: branch.collapsedAt,
      observedState: branch.observedState,
    };

    if (this.autoRecord) {
      this.recordEpoch(timelineId, 'superposition:observed', { branchId, collapsedAt: branch.collapsedAt });
    }

    this._emit('superposition:observed', result);
    return result;
  }

  /**
   * Get all uncollapsed (active) superposition branches.
   */
  getActiveSuperpositions(timelineId) {
    const handle = this._getTimeline(timelineId);
    const active = [];
    for (const [, branch] of handle.superpositions) {
      if (!branch.collapsed) {
        active.push({
          branchId: branch.branchId,
          probability: branch.probability,
          registeredAt: branch.registeredAt,
          depth: branch.depth,
        });
      }
    }
    return active;
  }

  // ── Epoch Recording ───────────────────────────────────────────────

  /**
   * Record a cognitive epoch — a point-in-time state snapshot with audit hash.
   */
  recordEpoch(timelineId, label, data) {
    const handle = this._getTimeline(timelineId);

    const timestamp = handle.playhead;
    const epochId = `${timelineId}_epoch_${this._epochIdCounter++}`;

    // Deterministic SHA-256 hash of (timestamp + label + JSON(data))
    const hashInput = `${timestamp}:${label}:${JSON.stringify(data)}`;
    const hash = sha256HexSync(hashInput);

    const record = {
      id: epochId,
      timelineId,
      timestamp,
      label,
      data,
      hash,
    };

    handle.epochs.push(record);
    this._emit('epoch:recorded', record);
    return record;
  }

  /**
   * Get all recorded epochs for a timeline.
   */
  getEpochs(timelineId) {
    const handle = this._getTimeline(timelineId);
    return handle.epochs.slice();
  }

  // ── Import / Export ───────────────────────────────────────────────

  /**
   * Export a timeline's full state for persistence.
   */
  exportTimeline(timelineId) {
    const handle = this._getTimeline(timelineId);

    const superpositionsExport = [];
    for (const [key, val] of handle.superpositions) {
      superpositionsExport.push({
        key,
        branchId: val.branchId,
        probability: val.probability,
        collapsed: val.collapsed,
        collapsedAt: val.collapsedAt,
        observedState: val.observedState,
        registeredAt: val.registeredAt,
        depth: val.depth,
      });
    }

    return {
      id: handle.id,
      duration: handle.duration,
      state: handle.state,
      playhead: handle.playhead,
      config: handle.config,
      tweens: handle.tweens.map(t => ({
        id: t.id,
        position: t.position,
        duration: t.duration,
        vars: t.vars,
        props: t.props,
        initialValues: t.initialValues,
      })),
      superpositions: superpositionsExport,
      epochs: handle.epochs,
    };
  }

  /**
   * Import a previously exported timeline state.
   */
  importTimeline(timelineId, data) {
    let handle = this._timelines.get(timelineId);
    if (handle) {
      this._stopPlayback(handle);
    } else {
      handle = new TimelineHandle(timelineId, data.config || {});
      this._timelines.set(timelineId, handle);
    }

    handle.duration = data.duration || 0;
    handle.state = data.state || 'idle';
    handle.playhead = data.playhead || 0;
    handle.config = data.config || {};

    // Reconstruct tweens (targets must be re-bound by caller)
    handle.tweens = [];
    if (data.tweens) {
      for (const td of data.tweens) {
        const tween = new Tween(td.id, null, td.vars || {}, td.position, td.duration);
        tween.props = td.props || {};
        tween.initialValues = td.initialValues || {};
        handle.tweens.push(tween);
      }
    }

    // Reconstruct superpositions
    handle.superpositions = new Map();
    if (data.superpositions) {
      for (const sp of data.superpositions) {
        handle.superpositions.set(sp.key || sp.branchId, {
          branchId: sp.branchId,
          probability: sp.probability,
          collapsed: sp.collapsed || false,
          collapsedAt: sp.collapsedAt || null,
          observedState: sp.observedState || null,
          registeredAt: sp.registeredAt || 0,
          depth: sp.depth || 0,
        });
      }
    }

    // Reconstruct epochs
    handle.epochs = data.epochs || [];

    this._emit('timeline:imported', { timelineId });
  }

  // ── Internal Helpers ──────────────────────────────────────────────

  _getTimeline(timelineId) {
    const handle = this._timelines.get(timelineId);
    if (!handle) {
      throw new Error(`Timeline '${timelineId}' not found`);
    }
    return handle;
  }

  _startPlayback(handle) {
    if (handle._tickInterval) return;

    const self = this;
    const intervalMs = 1000 / this.tickRate;
    handle._lastTickTime = Date.now();

    handle._tickInterval = setInterval(() => {
      const now = Date.now();
      const dt = (now - handle._lastTickTime) / 1000;
      handle._lastTickTime = now;

      handle.playhead += dt;

      if (handle.playhead >= handle.duration) {
        handle.playhead = handle.duration;
        self._stopPlayback(handle);
        handle.state = 'idle';

        self._emit('timeline:complete', { timelineId: handle.id });

        if (self.autoRecord) {
          self.recordEpoch(handle.id, 'timeline:complete', { duration: handle.duration });
        }
        return;
      }

      for (const tween of handle.tweens) {
        tween.applyAt(handle.playhead);
      }

      self._emit('timeline:tick', { timelineId: handle.id, playhead: handle.playhead });
    }, intervalMs);
  }

  _stopPlayback(handle) {
    if (handle._tickInterval) {
      clearInterval(handle._tickInterval);
      handle._tickInterval = null;
    }
    handle._lastTickTime = null;
  }

  _resolveSuperpositionAt(handle, time) {
    let bestBranch = null;
    let bestProbability = -1;

    for (const [, branch] of handle.superpositions) {
      if (!branch.collapsed && branch.registeredAt <= time && branch.probability > bestProbability) {
        bestBranch = branch;
        bestProbability = branch.probability;
      }
    }

    if (!bestBranch) return null;

    return {
      branchId: bestBranch.branchId,
      probability: bestBranch.probability,
      registeredAt: bestBranch.registeredAt,
      depth: bestBranch.depth,
    };
  }
}

// ── Module Exports ────────────────────────────────────────────────────
export { GSAPTemporalSync, Tween, TimelineHandle, sha256HexSync, sha256Hex };
export default GSAPTemporalSync;
