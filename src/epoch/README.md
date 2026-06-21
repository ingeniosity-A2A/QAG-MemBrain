# EPOCH — AMOS v2.1

**Status:** GREENFIELD (placeholder on `mobile-runtime` branch)

EPOCH is the **structured adaptive presentation** pillar — combines ArrowJS
Sandbox (for safe agent output rendering) with GSAP (for animation).

## Implementation split

- **WASM modules** → `wasm/` (ArrowJS Sandbox payloads)
- **TS components** → `src/epoch/` (React components consumed by mobile/capacitor/)
- **Mobile shell** → `mobile/capacitor/src/components/` (AnimatedUI, AgentSandbox, FurnitureViewer)

## Responsibilities

- Render agent outputs in a sandboxed, animated, adaptive UI
- Stream GSAP frames to Adreno GPU
- Provide 3D furniture/scene viewer (Three.js)
- Coordinate with Meta Harness for safety validation

## Files (planned)

```
src/epoch/
├── README.md
├── PLACEHOLDER.manifest.json
├── index.ts
├── AnimatedUI.ts             # GSAP animation orchestrator
├── AgentSandbox.ts           # ArrowJS Sandbox wrapper
├── FurnitureViewer.ts        # Three.js 3D scene viewer
├── FrameScheduler.ts         # 60fps frame scheduler
└── AdaptiveLayout.ts         # Adaptive presentation logic
```
