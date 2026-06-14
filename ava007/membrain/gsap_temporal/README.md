# QAG-MemBrain — Layer 5: GSAP Temporal Synchronization

> Part of the Ava007 Cognitive Runtime

## Overview

The GSAP Temporal Synchronization layer bridges the GreenSock Animation Platform (GSAP) with cognitive temporal memory. It provides **deterministic lifecycle management**, **superposition observation/collapse**, and **cognitive epoch visualization** for the Ava007 cognitive runtime.

This layer is the Python-side counterpart to the TypeScript `GSAPTemporalReconstructor` at `src/memory/temporal/gsap_replay.ts`, adding terminal-based visualization capabilities and maintaining API parity with the JS runtime.

## Architecture

```
┌──────────────────────────────────────────────────┐
│              LAYER 5: GSAP TEMPORAL              │
├──────────────────────────────────────────────────┤
│                                                  │
│  ┌──────────────────┐  ┌──────────────────────┐  │
│  │  gsap_temporal.js │  │  visualization.py    │  │
│  │  (Node.js/Browser)│  │  (Python stdlib)     │  │
│  │                    │  │                      │  │
│  │  • Timeline CRUD   │  │  • Timeline bar      │  │
│  │  • Tween engine    │  │  • Superposition tree │  │
│  │  • Playback ctrl   │  │  • Epoch detail       │  │
│  │  • Superposition   │  │  • Heatmap            │  │
│  │  • Epoch recording │  │  • State transitions  │  │
│  │  • Import/Export   │  │                       │  │
│  └────────┬───────────┘  └──────────┬───────────┘  │
│           │                         │              │
│           └─────────┬───────────────┘              │
│                     ▼                              │
│           ┌─────────────────┐                      │
│           │  SHA-256 Audit  │                      │
│           │  Epoch Hashing  │                      │
│           └─────────────────┘                      │
│                                                  │
├──────────────────────────────────────────────────┤
│  Upstream: L4 CavernBridge (Audio sync)           │
│  Downstream: L6 Memory Persistence               │
└──────────────────────────────────────────────────┘
```

## Files

| File | Language | Purpose |
|------|----------|---------|
| `gsap_temporal.js` | JavaScript | Core GSAP-compatible timeline engine with superposition & epoch management |
| `visualization.py` | Python | ASCII/Unicode visualization for cognitive epochs (stdlib only) |
| `__init__.py` | Python | Package exports: `CognitiveEpochVisualizer` + convenience functions |
| `README.md` | Markdown | This document |

## gsap_temporal.js — Core Engine

### Class: `GSAPTemporalSync`

The main engine class. No GSAP dependency required — implements a lightweight, GSAP-API-compatible timeline engine.

```javascript
const { GSAPTemporalSync } = require('./gsap_temporal');

const sync = new GSAPTemporalSync({ maxDepth: 5, tickRate: 60, autoRecord: true });
```

#### Constructor Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxDepth` | number | 5 | Maximum superposition nesting depth |
| `tickRate` | number | 60 | Playback tick rate in Hz |
| `autoRecord` | boolean | true | Auto-record epoch on state changes |

#### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `createTimeline(id, config?)` | `TimelineHandle` | Create a named timeline |
| `addTween(timelineId, target, vars, position?)` | `string` | Add tween, returns tween ID |
| `scrubTo(timelineId, timestamp)` | `ScrubResult` | Scrub to exact timestamp |
| `pause(timelineId)` | void | Pause playback |
| `resume(timelineId)` | void | Resume playback |
| `seek(timelineId, timestamp)` | void | Seek without playing |
| `getPlayhead(timelineId)` | `number` | Current playhead in seconds |
| `registerSuperposition(timelineId, branchId, probability)` | void | Register alternative state |
| `observeSuperposition(timelineId, branchId)` | `SuperpositionResult` | Collapse a branch |
| `getActiveSuperpositions(timelineId)` | `Array` | Get uncollapsed branches |
| `recordEpoch(timelineId, label, data)` | `EpochRecord` | Record state snapshot |
| `getEpochs(timelineId)` | `Array` | Get all recorded epochs |
| `exportTimeline(timelineId)` | `object` | Export for persistence |
| `importTimeline(timelineId, data)` | void | Import from persistence |

#### Data Types

**TimelineHandle**: `{ id, duration, tweens, superpositions, epochs, state, playhead, config }`

**ScrubResult**: `{ timelineId, timestamp, state, superposition, velocity }`

**SuperpositionResult**: `{ branchId, probability, collapsedAt, observedState }`

**EpochRecord**: `{ id, timelineId, timestamp, label, data, hash }`

### Determinism & Audit

Every `EpochRecord` includes a SHA-256 hash computed from `timestamp:label:JSON(data)`. In Node.js this uses the `crypto` module synchronously. In browser environments, a deterministic fallback hash is used.

### GSAP Position Syntax

The `addTween` method supports GSAP-style position parameters:

- `undefined` — Append at end of timeline
- `number` — Absolute position in seconds
- `"+=1"` — Relative to current playhead (+1s)
- `"-=0.5"` — Relative to current playhead (-0.5s)
- `">"` — End of timeline
- `"<"` — Start of timeline

### Easing Functions

Built-in easing: `linear`, `power1`–`power4`, `easeIn`, `easeOut`, `easeInOut`, `back`, `elastic`, `bounce`.

### Events

The engine emits events (requires Node.js `EventEmitter`):

- `timeline:created`, `timeline:destroyed`
- `tween:added`
- `timeline:scrubbed`, `timeline:paused`, `timeline:resumed`
- `timeline:tick`, `timeline:complete`
- `superposition:registered`, `superposition:observed`
- `epoch:recorded`
- `timeline:imported`

## visualization.py — Cognitive Epoch Visualizer

### Class: `CognitiveEpochVisualizer`

Terminal-based ASCII/Unicode visualization. No matplotlib or external dependencies.

```python
from ava007.membrain.gsap_temporal import CognitiveEpochVisualizer

viz = CognitiveEpochVisualizer()
print(viz.render_timeline(epochs, width=80))
```

#### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `render_timeline(epochs, width=80)` | `str` | ASCII timeline bar with epoch markers |
| `render_superposition_tree(branches)` | `str` | Unicode tree of superposition branches |
| `render_epoch_detail(epoch)` | `str` | Detailed epoch info box |
| `render_heatmap(epochs, bins=20)` | `str` | Temporal activity heatmap |
| `render_state_transition(epochs)` | `str` | State transition diagram |

#### Visualization Examples

**Timeline Bar**:
```
|─·[TC]·····[TR]·········[TP]·········[TR]·········[TD]──→
  [TC] = timeline:created @ t=0.000s  (id: e1)
  [TR] = timeline:resumed @ t=1.500s  (id: e2)
  [TP] = timeline:paused @ t=3.000s  (id: e3)
```

**Superposition Tree**:
```
Timeline Root
├── alpha  ████████░░ p=0.700 [active]  registered@t=0.000
└── beta   ███░░░░░░░ p=0.300 [✓ collapsed @ t=3.0]
    → state: {"x": 42}
```

**Heatmap**:
```
0.0s──────────────────────6.0s
  ░░▒▓██▓▒░░▒▓█▓▒░░░▒▓░░░░
  ░░░▒▓██▓▒░░▒▓█▓▒░░░▒▓░░░░
  ░░░░▒▓█▓▒░░░▒▓█░░░░░▒░░░░
  1   1   1   1   1   1      
Density:  =none ░=low ▒=med ▓=high █=max
```

**State Transition**:
```
  ─────── ──→ ──────── ──→ ─────── ──→ ──────── ──→ ─────
   IDLE        PLAYING       PAUSED       PLAYING       DONE
  ─────── ──→ ──────── ──→ ─────── ──→ ──────── ──→ ─────
   t=0.00      t=1.50       t=3.00       t=4.20       t=6.00
```

## Integration with Ava007 Runtime

### Upstream: CavernBridge (L4)

The GSAP temporal layer receives audio sync events from CavernBridge:

```javascript
cavernBridge.on('audio:beat', (beat) => {
  sync.scrubTo('main', beat.timestamp);
});
```

### Downstream: Memory Persistence (L6)

Exported timelines are persisted through the memory layer:

```javascript
const exported = sync.exportTimeline('main');
await memoryLayer.persist('timeline:main', exported);
```

### Cross-Runtime Parity

The JavaScript engine mirrors the TypeScript `GSAPTemporalReconstructor` API:

| TypeScript (replay.ts) | JavaScript (gsap_temporal.js) |
|------------------------|-------------------------------|
| `reconstruct(timeline)` | `sync.scrubTo(id, ts)` |
| `addBranch(id, prob)` | `sync.registerSuperposition(id, branch, prob)` |
| `collapseBranch(id)` | `sync.observeSuperposition(id, branch)` |
| `getEpochs()` | `sync.getEpochs(id)` |

## Running Self-Tests

```bash
# Python visualization self-test
python -m ava007.membrain.gsap_temporal.visualization

# JavaScript engine test (Node.js)
node -e "
const { GSAPTemporalSync } = require('./gsap_temporal.js');
const s = new GSAPTemporalSync();
const tl = s.createTimeline('test');
s.addTween('test', { x: 0 }, { x: 100, duration: 2 }, 0);
const r = s.scrubTo('test', 1.0);
console.log('Scrub result:', JSON.stringify(r.state));
console.log('Epochs:', s.getEpochs('test').length);
"
```

## License

Internal — Ava007 Cognitive Runtime
