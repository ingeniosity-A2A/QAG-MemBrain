# Constellation — AMOS v2.1

**Status:** GREENFIELD (placeholder on `mobile-runtime` branch)

Constellation is the **dynamic model routing layer** that sits between
AVA007/Meta Harness and all inference backends.

## Implementation split

- **Rust core** → `rust/constellation/` (NDK-exposed)
- **TS bindings** → `src/constellation/` (called from web shell + services)

## Responsibilities

- **Model Selection**: Gemma, GLM, Qwen, local llamdrop, WebLLM, cloud quantized
- **Quantization & Backend**: 1.58-bit T-MAN, 4-bit, QNN NPU, WebGPU, CPU, llamdrop
- **Budget Awareness**: latency, battery, thermal, RAM on S25/S26 Ultra
- **Hybrid Routing**: local-first for privacy; cloud only when necessary
- **Fallback & Load Balancing**: real-time health checks

## Flow

AVA007/Meta Harness → Constellation → Selected Model/Backend → Result back to
Meta Harness → TASHI + GSAP reconstruction.

## Files (planned)

```
src/constellation/
├── README.md
├── PLACEHOLDER.manifest.json
├── index.ts                  # TS entry point
├── Router.ts                 # Main routing logic
├── BackendRegistry.ts        # Available backends
├── BudgetCalculator.ts       # Latency/battery/thermal budgets
├── HealthChecker.ts          # Real-time backend health
└── PolicyStore.ts            # DuckDB-backed routing policies
```
