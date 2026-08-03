# OQ-011 — AMOS Cognitive Stack Retirement

**Status:** Proposed  
**Priority:** Critical  
**Affected layers:** L2, L3, L4  
**Date raised:** 2026-08-04  
**Referenced:** `Ava007/docs/exoskeleton/open-questions.md` (OQ-001 through OQ-010)

---

## Question

Should the AMOS Rust cognitive stack (`packages/amos/` in Ava007) be removed from the Ava007 repo?

## Factual Basis

### What AMOS Is

26 Rust crates across 6 layers (substrate, core, executive, capabilities, harnesses, runtime) with `LAYER_POLICY.toml` CI enforcement via `xtask verify`. Located at `packages/amos/` in the Ava007 repo.

### What AMOS Was Used For (Today's Session)

Nothing. Zero.

The entire Ingeniosity Lens pipeline was built in TypeScript:

| Component | File | Language |
|-----------|------|----------|
| T-MAN / NPU abstraction | `src/lib/exoskeleton/ingeniosity-lens/tman-npu.ts` | TypeScript |
| LiteParse adapter | `src/lib/exoskeleton/ingeniosity-lens/liteparse-adapter.ts` | TypeScript |
| Pipeline orchestration | `src/lib/exoskeleton/ingeniosity-lens/pipeline.ts` | TypeScript |
| DuckDB-WASM storage | `src/app/api/lens/store-results/route.ts` | TypeScript |
| Catalog scanning | `src/app/api/lens/scan-catalog/route.ts` | TypeScript |
| React UI | `src/components/ava/IngeniosityLens.tsx` | TypeScript |

All Arrow IPC uses `apache-arrow` npm package. All inference uses `onnxruntime-web`. All storage uses `@duckdb/duckdb-wasm`. All parsing uses `@llamaindex/liteparse-wasm`.

### What AMOS Contains That Is NOT Connected to Working Code

| AMOS Component | What It Has | What It Connects To |
|----------------|-------------|---------------------|
| `substrate/arrow_bridge` | Custom columnar model (NOT real arrow-rs) | Nothing — no IPC serialization | 
| `core/atomic_memory` | Append-only log with DeltaCursor | Nothing — no DuckDB, no real Arrow |
| `core/rev_ike` | Model router, capability dispatch | Nothing — TypeScript Constellation does actual routing |
| `capabilities/esa_inventory` | 324-line Rust capability | Nothing — no path from TS pipeline to Rust handler |
| `runtime/` | Axum HTTP server (14 endpoints) | Nothing — Next.js is the actual server |
| `LAYER_POLICY.toml` | CI enforcement of 22 crates | Enforces boundaries on code that isn't being used |

### What AMOS Is Missing

- Zero `.onnx` files anywhere
- Zero `ort` (ONNX Runtime) crate in any `Cargo.toml`
- Zero `duckdb` crate in AMOS workspace
- Zero real `arrow` or `arrow-ipc` crates (custom `arrow_bridge` only)
- Zero NPU/hardware abstraction code
- Zero T-MAN implementation
- Zero Lens capability
- The `runtime/lib.rs` comment literally states: *"real android/webllm/qnn/onnx backends are follow-up work at the substrate level"*

## Conflict with Existing Open Questions

### OQ-004 (Constellation vs. brain.ts)

AMOS `core/rev_ike` has its own `model_router` and `capability_runtime` — a third implementation alongside the TS `brain.ts` and TS `Constellation`. This is the exact "duplicate authority" that OQ-004's closure condition forbids: *"One component owns cognitive-band selection, and one component owns concrete model assignment. No duplicate authority remains."*

### OQ-009 (L4 Decision vs. L3 Resolution)

AMOS implements its own L4 Intent → L3 Execution Plan split in Rust, parallel to the TypeScript implementation. This creates two competing resolution paths — violating the closure condition: *"The Intent schema and Execution Plan schema contain no overlapping ownership fields."*

### OQ-008 (Policy)

AMOS has its own `core/governance` with `Rule`, `Condition`, `Fact`, `Decision` types — a parallel policy engine to whatever QAG-MemBrain governs. The charter states *"No subsystem may become a second source of truth."* AMOS governance is architecturally adrift.

### OQ-010 (Reflex Naming Collision)

AMOS has no Reflex implementation at all, but its `rev_ike/model_router` references `"reflex"` as a routing tier — adding a third party to an already unresolved naming collision.

### Change-Control Rule Violation

The open-questions Change-Control Rule requires every architectural name to declare layer, owner, input/output contracts, execution authority, and state ownership. AMOS introduced 22 crate names with defined layers but zero runtime connections — they exist only on paper.

## Architectural Concern

AMOS creates a **phantom architecture**: a fully specified Rust cognitive stack that is not wired to any running system. This causes:

1. **Terminology confusion** — discussions reference AMOS layers/components that don't execute
2. **Duplicate control planes** — Rust rev_ike vs. TS Constellation vs. TS brain.ts
3. **False layer boundaries** — `LAYER_POLICY.toml` enforces boundaries on dead code while the real TypeScript pipeline has no formal layer enforcement
4. **Onboarding debt** — new contributors must parse two parallel architectures to understand one working system

## Proposal

### Option A — Remove AMOS Entirely (Recommended)

Delete `packages/amos/` from the Ava007 repo. Archive to a separate branch if needed for reference.

The real cognitive architecture lives in TypeScript:
- L4: `src/lib/exoskeleton/brain.ts`
- L3: `packages/constellation/` (model assignment)
- L2: Harness pool (TS)
- Capabilities: `src/lib/exoskeleton/ingeniosity-lens/`, `src/lib/exoskeleton/capabilities/`
- Memory/Cognition: QAG-MemBrain repo (this repo)

### Option B — Demote AMOS to Reference Only

Move `packages/amos/` to `packages/amos-reference/` with a `README.md` stating it is an architectural reference, not executable code. Remove from CI, remove from workspace `Cargo.toml`.

### Option C — Keep and Commit to Porting

Explicitly decide to port the TS pipeline into AMOS Rust crates. This means:
- Add `ort`, `arrow`, `arrow-ipc`, `duckdb` crates to AMOS workspace
- Implement T-MAN in `substrate/`
- Upgrade `arrow_bridge` to real Arrow IPC
- Add DuckDB to `core/atomic_memory`
- Create `capabilities/ingenuity_lens` Rust capability
- Wire `runtime/` Axum server as the actual API layer (replacing Next.js API routes)

This is a multi-week effort with no near-term deliverable impact.

## Required Decision

```text
AMOS status:          [ remove | demote-to-reference | commit-to-port ]
Decision owner:       
Effective date:       
Transition plan:      
Affected OQ items:    OQ-004, OQ-008, OQ-009, OQ-010
```

## Closure Condition

Either AMOS is removed/demoted and all open-question references to Rust-only components (rev_ike model_router, governance, arrow_bridge) are updated to point to the actual TypeScript implementations — or a concrete porting timeline with milestones is recorded and the duplicate authority is acknowledged as temporary.
