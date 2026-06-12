# /temporal — GSAP Temporal Orchestration (Layer 2)

Converts JSONL atoms into tween atoms and sequences them into a deterministic timeline.

**Hard rule:** No DOM access. No `document`. No `window`. No canvas.
GSAP here operates only on plain state objects. Rendering is the surface's responsibility.

## /gsap
`timelineOrchestrator.ts` — ingests atoms, drives `gsap.to(stateObject, tweenAtom)`.
The target is always a plain JS object, never a DOM element or Three.js mesh.

## /timeline
Serialization to/from JSONL. Branch and counterfactual logic. `replay.ts`.

**Determinism guarantee:** `replay(timeline, t0) === replay(timeline, t0)` for any `t0`.
This is a hard invariant. Any change that breaks it is a breaking change.

## /serialization
`jsonlToTween.ts` — converts JSONL atom → GSAP tween atom (duration, ease, target fields).
`tweenToJsonl.ts` — serializes resolved tween atom back to JSONL for audit.
