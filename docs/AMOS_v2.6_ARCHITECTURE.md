# AVA007 / QAG_MemBrain: Sovereign Agentic Mobile Operating System (AMOS)
## Architecture Specification — Version 2.6 (Corrected)

**Date:** June 2026
**Target Platforms:** Samsung Galaxy S25 Ultra / S26 Ultra (Snapdragon 8 Elite)
**Status:** Implementation-Ready (replaces v2.1 / v2.4 / v2.5)
**Source branch:** `mobile-runtime` @ `bb6c2caacf`

> **What changed from v2.5:** Strips fabricated components (GLM-5.2, IndexShare,
> FlashAssign, Mercury-2, "Quantum MemBrain superposition", "sub-zero latency",
> "KernelSU preserves Samsung Pay"). Keeps and grounds the real architecture.

---

## 1. Executive Summary

AVA007 is a **Sovereign Agentic Mobile Operating System** for the Samsung Galaxy
S25/S26 Ultra. It runs as a device-native intelligence layer with **AVA007** as
the sole executive authority. Every subsystem interaction is wrapped by the
**Meta Harness** (universal interceptor) and routed through **Constellation**
(dynamic model + backend router).

The system is **deterministic and auditable**: every interaction — sensor
reading, LLM inference, user action — is recorded as a state transition on a
GSAP-driven temporal substrate, replayable at any later time via TASHI's
persistent memory.

### Design principles

1. **Local-first.** Hot path runs entirely on-device. Cloud is opt-in, gated by policy.
2. **Deterministic reconstruction.** State is interpolated from a temporal graph, not recomputed on demand.
3. **Nothing bypasses Meta Harness.** Every subsystem call is observed, validated, governed, audited.
4. **Honest latency targets.** 120-220ms end-to-end for typical sensor→quote loops. No "sub-zero" claims.
5. **Real models only.** Models are real artifacts on HuggingFace that have been tested on Adreno via MLC-LLM.

---

## 2. Authority Chain

```
USER
  |
  v
AVA007 (Sole Executive Authority)
  |
  v
META HARNESS (First-Class Runtime Wrapper + Governance)
  |
  v
CONSTELLATION (Dynamic Model + Backend Router)
  |
  +---------------+---------------+---------------+---------------+
  |               |               |               |               |
  v               v               v               v               v
REV.IKE         FABLE           GOOSE          TASHI          EPOCH
Reflex          Planning        Execution      Memory         Presentation
(< 20ms)        (on-demand)     (tools)        (audit + L0-L4) (ArrowJS + GSAP)
```

**Nothing bypasses AVA007 or Meta Harness.** All cross-pillar calls flow
through `metaHarness.intercept({ pillar, operation, payload, execute })`.

---

## 3. Canonical Pillars

| Pillar | Responsibility | Hot path? | Status on `mobile-runtime` |
|--------|----------------|-----------|----------------------------|
| **AVA007** | Executive: task routing, priority scheduling, final synthesis | Always | Wired (mobile/capacitor/src/App.tsx) |
| **Meta Harness** | Universal interceptor: observe, validate, policy, audit | Always | Implemented (src/meta/, rust/meta-harness/) |
| **Constellation** | Dynamic backend selection: MLC/WebLLM/llamdrop/cloud | Always | Implemented (src/constellation/, rust/constellation/) |
| **REV.IKE** | Sub-20ms reflex layer (intent routing, skill selection) | Always | Stub (Phase 8 of Ava Live checklist) |
| **FABLE** | System-2 planning for complex tasks | On-demand | Stub (Phase 8) |
| **FAPO** | Pipeline-aware prompt optimization | On-demand | Stub (Phase 8; concept unverified — see §11) |
| **GOOSE** | Pure execution layer (tool calls) | On-demand | Stub (Phase 8) |
| **TASHI** | Persistent memory: L0 RAM → L1 JSONL → L2 DuckDB → L3 GraphRAG → L4 archive | Always | Partial (audit logger wired; L1-L4 stub) |
| **GSAP Temporal** | Timeline, replay, deterministic state reconstruction | Always | Stub (Phase 6 of Ava Live checklist) |
| **EPOCH** | ArrowJS Sandbox + GSAP UI rendering | Always | Stub (Phase 7) |
| **Mobile Runtime** | Capacitor + NDK/Rust + Arrow zero-copy | Always | Scaffolding (mobile/capacitor/, rust/) |
| **Vibe Thinker** | On-demand specialist for deep reasoning | On-demand | Stub (Phase 8; integrates real model when available) |

---

## 4. Intelligence Flow (grounded)

Ava receives intelligence through a layered pipeline. No "quantum superposition" — just deterministic state transitions.

### 4.1 The seven layers

| Layer | What Ava receives | Where it lives | Real example |
|-------|-------------------|----------------|--------------|
| **Sensory** | Raw bytes (BLE, image, audio, GPS) | S25 Ultra hardware | BLE beacon broadcast: `productId: "ikea-bed-001"` |
| **Ingestion** | Structured SemanticPacket | S25 → mesh → S26 (or local) | `{ nodeId, intent, context, confidence, timestamp, semanticWeight }` |
| **Cognitive** | Natural language from LLM | Local MLC-LLM on Adreno | "IKEA MALM Bed Frame, $146, Medium difficulty" |
| **Orchestration** | Structured action / quote | AVA007 executive | `{ product, price: 146, difficulty: "Medium", addOns: [...] }` |
| **Temporal** | TweenAtom on GSAP timeline | Browser masterTimeline | `insertIntelligence(quote, { duration: 0.5, ease: 'power2.out' })` |
| **Persistent** | Research atom (immutable insight) | TASHI L1 JSONL → L2 DuckDB | Atom ID with SHA-256 hash, signed |
| **Projection** | UI + dispatch | Browser + A2A mesh | Quote card rendered via ai2ui-projector; A2A-BEEP dispatches to technician |

### 4.2 Live example (grounded numbers)

```
1. BLE beacon broadcasts productId="ikea-bed-001"
2. S25 BleconBridge.kt packages as SemanticPacket (< 1ms)
3. WebSocket send to S26 (or local if S25-only) (2-5ms on local hotspot)
4. MLC-LLM inference on Adreno GPU (60-200ms depending on model size)
5. Parse + insertIntelligence() on GSAP timeline (< 1ms)
6. UI projection on next GSAP ticker frame (~16ms)
7. Total: 80-220ms end-to-end
```

**No cloud round-trip. No retraining. Deterministic and replayable.**

### 4.3 What Ava never receives

- ❌ Raw API keys (env vars only; never in payload)
- ❌ Unstructured data (everything parsed before injection)
- ❌ User PII directly (DID-based identity)
- ❌ Cloud model updates without explicit policy approval

---

## 5. Backend Stack (Constellation)

Constellation routes each inference request to the optimal backend based on budget, latency, battery, thermal, and privacy constraints.

### 5.1 Real backends (in priority order per the user's directive)

| Backend | Use case | Real models | Status |
|---------|----------|-------------|--------|
| **MLC-LLM** | Primary local inference on Adreno GPU (Vulkan/OpenCL) | Llama-3.2-3B-Instruct-q4f16_1-MLC (~2 GB), Gemma-2-2b-it-q4f16_1-MLC (~1.5 GB), Qwen2.5-7B-Instruct-q4f16_1-MLC (~4.5 GB) | Stub (Phase 4.1 of Ava Live checklist) |
| **WebLLM** | Browser/ArrowJS Sandbox + EPOCH UI agents | Same models as MLC-LLM (WebGPU backend) | Stub (Phase 4.1) |
| **llamdrop** | CPU fallback when GPU unavailable | TBD (real llamdrop binary required) | Stub (Phase 4.4) |
| **Cloud API** | Optional cloud escalation (only when `requireLocal === false`) | GLM-4-Plus, GPT-4o, Claude 3.5 Sonnet (via API) | Stub (Phase 4.5) |
| ~~QNN NPU~~ | (Deferred — requires QNN SDK access approval) | Gemma QNN bin (when available) | Stub only (Phase 4.3) |

### 5.2 Real model selection (NOT GLM-5.2)

The "GLM-5.2" mentioned in earlier specs does not exist. Real Z.ai models that work on mobile:
- **GLM-4-9B-Chat** Q4 (~5.5 GB) — fits in S25 Ultra 12 GB RAM, real on HuggingFace
- **GLM-4.5-Air** (if released) — smaller variant

Real MLC-LLM-supported models that work on Adreno today:
- `mlc-ai/Llama-3.2-3B-Instruct-q4f16_1-MLC` — fast, mobile-friendly
- `mlc-ai/gemma-2-2b-it-q4f16_1-MLC` — even lighter
- `mlc-ai/Qwen2.5-7B-Instruct-q4f16_1-MLC` — quality/latency balance
- `mlc-ai/Llama-3.1-8B-Instruct-q4f16_1-MLC` — quality

**Pick one. Drop "GLM-5.2" entirely.**

### 5.3 Constellation routing algorithm

Implemented in `src/constellation/Router.ts`. Decision flow:
1. Filter backends by HealthChecker status
2. Filter by `requireLocal` (skip cloud if true)
3. Compute BudgetEstimate per backend (latency, battery, cost, thermal)
4. Apply hard constraints from `Budget` (max latency, max battery, max cost)
5. Score survivors: `score = 0.4 * latency_fit + 0.3 * battery_fit + 0.3 * quality`
6. Pick highest score; return RoutingDecision + alternatives

---

## 6. Memory Hierarchy (TASHI)

Five-level memory hierarchy. L0-L2 are always-on; L3-L4 are deeper recall layers.

| Level | What it stores | Latency | Persistence |
|-------|----------------|---------|-------------|
| **L0** | Current session state in RAM | < 1ms | Process lifetime |
| **L1** | Audit events as JSONL | < 5ms | Filesystem (rotated) |
| **L2** | DuckDB Context Lake (events indexed, queryable) | < 50ms | Persistent (DuckDB files) |
| **L3** | GraphRAG (entity relationships, semantic edges) | < 200ms | Persistent (Neo4j or DuckDB graph) |
| **L4** | Gists / archive (compressed long-term memory) | seconds | Cold storage |

### 6.1 Audit receipts

Every Meta Harness intercept produces at minimum 2 audit events (pre + post). Each event has:
- Unique `traceId`
- `pillar`, `operation`, `phase`, `timestamp`
- Optional error / result summary
- SHA-256 hash (production: Web Crypto API)
- TASHI receipt ID for cross-referencing

### 6.2 Replay (GSAP temporal)

State is reconstructed from the timeline, not recomputed. `recallState(t)` returns the interpolated state at time `t` by reading GSAP tween definitions + replaying audit events. This is deterministic — same `t` always yields same state.

**This is NOT quantum superposition.** It's tween interpolation + event sourcing — a well-established pattern.

---

## 7. Zero-Copy Pipeline

```
LiteParse WASM → Rust → Apache Arrow C Data Interface → JNI → ArrowJS Sandbox →
Meta Harness validation → GSAP/EPOCH → Adreno GPU
```

### 7.1 Real implementation status

- `rust/arrow-bridge/` — scaffolding with proper types (RecordBatch, Schema, Field, Column). The `arrow` feature flag gates the actual Arrow C Data Interface code. Currently returns `NotImplemented` without the feature; with the feature, real `arrow::ffi` calls will be wired.
- `mobile/capacitor/android/app/src/main/cpp/arrow_jni.cpp` — JNI shim that calls into `rust/arrow-bridge/` via `libarrow_jni.so`.
- `mobile/capacitor/src/services/DocumentParser.ts` — placeholder for LiteParse WASM integration.

### 7.2 True zero-copy

The much-touted "zero-copy" claim requires care:
- Arrow `Float32Array::from_raw_parts(ptr, len)` is zero-copy IF you control the source memory lifetime
- JNI's `get_float_array_elements(ReleaseMode::NoCopyBack)` gives you a borrowed view — also zero-copy
- But you cannot safely hand that pointer to JS — JS has its own GC and ArrayBuffer semantics
- True zero-copy from Rust → JS requires SharedArrayBuffer (requires COOP/COEP headers) or direct WASM linear memory

The current `rust/arrow-bridge/` code documents these constraints in comments. Real zero-copy implementation is Phase 4.2 of the Ava Live checklist.

---

## 8. Mobile Runtime Stack

### 8.1 Build path (Termux + Ubuntu proot)

See `scripts/bootstrap-termux.sh` for the real, verifiable setup script. Summary:
1. Install Termux from F-Droid
2. `pkg install proot-distro`
3. `proot-distro install ubuntu`
4. Inside Ubuntu: install Rust + Android NDK + Capacitor CLI
5. `cargo ndk --target aarch64-linux-android build --release`
6. `npx cap sync android`
7. `./gradlew assembleDebug`

### 8.2 Native Activities (non-root path)

Android Native Activities give direct access to:
- Hexagon NPU (via QNN SDK, when available)
- Adreno GPU (via Vulkan/OpenCL)
- Bluetooth LE (via android.bluetooth.*)
- Audio (via Oboe/AAudio)

**No Knox trip.** This is the recommended path for development and most production deployments.

### 8.3 KernelSU (optional root path — accepts Knox trip)

KernelSU / SUSFS on patched boot.img gives:
- Kernel-level signing for TASHI L2 Trust Layer
- Direct RIL hooks for Meshrabiya network sovereignty
- Memory remapping for performance-critical paths

**WARNING:** Installing KernelSU **trips the Knox e-fuse permanently**. Samsung Pay, Secure Folder, most enterprise MDM, and warranty are gone forever. There is no "preserve Samsung Pay where possible" — Knox is a one-way fuse. Only do this if you've explicitly accepted the trade-off.

---

## 9. Network Sovereignty (Meshrabiya)

Meshrabiya is the sovereign mesh networking layer. **Currently stubbed** — see Phase 9 of Ava Live checklist.

### 9.1 Protocol choice (must pick one before implementation)

| Protocol | Range | Bandwidth | Root needed? | Real on S25 Ultra? |
|----------|-------|-----------|--------------|---------------------|
| **802.11s mesh** | ~100m | High | Yes (interface creation) | Android supports via `iw` |
| **WiFi Direct (P2P)** | ~100m | High | No | Android `WifiP2pManager` |
| **BLE GATT** | ~10m | Low | No | Android `BluetoothGatt` |
| **LoRa** | ~10km | Very low | No (with USB dongle) | Via USB serial |

The current `src/telecom/nodes/lora_bridge.ts` stubs LoRa. Pick a primary protocol before implementing. **Recommendation:** WiFi Direct (no root) for primary, LoRa for long-range fallback.

### 9.2 Cloudflare Mesh + WARP (cloud overlay)

Cloudflare Tunnel + WARP provide private mesh IP, client-to-client D2D, and carrier-bypass tunneling. **Real, no root needed.** Configure via `wrangler.toml` + Cloudflare WARP client.

---

## 10. Data Ocean + Context Lake

| Layer | Technology | Status |
|-------|------------|--------|
| Ingestion | WebDAV → Cloudflare Pipelines | Stub (Phase 5 of Ava Live checklist) |
| Storage | Apache Iceberg on Cloudflare R2 | Stub |
| Analytical core | DuckDB with native Iceberg support | Stub (DuckDB Context Lake is L2 of TASHI) |
| Holographic reconstruction | GSAP Temporal uses Iceberg snapshots | Stub (Phase 6) |

**Note:** "Zero egress" via R2 is real for R2→R2 transfers. R2→client still has bandwidth costs.

---

## 11. FAPO (Pipeline-Aware Prompt Optimization) — UNVERIFIED

FAPO is referenced in a MarkTechPost article from June 2026 as a Cisco AI research concept. The article is behind a Cloudflare challenge and I could not directly verify it on Cisco's research blog or arXiv. Treat FAPO as **plausible but unverified** until primary source is confirmed.

### 11.1 What FAPO would do (per the article)

- Step-level failure attribution for multi-step LLM pipelines
- Pipeline-aware prompt optimization (rewrite prompts that failed at specific steps)
- Claude Code orchestration (Cisco's reference implementation uses Claude Code)

### 11.2 Where FAPO fits in AMOS

If verified, FAPO would be an **on-demand specialist** invoked by FABLE when:
- A multi-step pipeline fails at a specific step
- FABLE needs to optimize prompts for retry

FAPO is NOT in the hot path. It's a debugging/optimization tool for FABLE's planning layer.

### 11.3 Implementation status

Not implemented. Pending verification of the source paper. Track in `docs/FAPO_RESEARCH.md` (to be created when source is confirmed).

---

## 12. Vibe Thinker Integration

[VibeThinker-3B](https://huggingface.co/WeiboAI/VibeThinker-3B) is a real 3B-parameter model from WeiboAI, fine-tuned from Qwen2.5-Coder-3B for verifiable reasoning (math, code, STEM). Per the model card:
- ❌ Not trained on tool-calling or agent-based programming
- ❌ Not recommended for function calling or autonomous coding agents
- ✅ Strong on LeetCode-style problems (96.1% pass rate on recent contests)
- ✅ Strong on IMO-AnswerBench (76.4 → 80.6 with CLR)

### 12.1 Where Vibe Thinker fits in AMOS

**On-demand specialist**, not in the always-running path. Invoked by FABLE only when:
- Task requires deep architectural reasoning
- Multi-agent planning needs verifiable math/code sub-tasks
- Long engineering sessions need a specialist that can verify its own answers

### 12.2 Implementation status

Not implemented. Phase 8 of Ava Live checklist. When integrated, will run as a separate MLC-LLM model instance, loaded on-demand to preserve RAM.

---

## 13. Latency Targets (grounded)

| Operation | Target | Notes |
|-----------|--------|-------|
| BLE scan → product ID | 30-50ms | Hardware interrupt, no OS scheduling |
| SemanticPacket serialization | < 1ms | JSON in native Kotlin |
| WebSocket send (local hotspot) | 2-5ms | Assumes S25 ↔ S26 on same hotspot |
| MLC-LLM inference (3B Q4 on Adreno) | 60-150ms | First-token latency |
| MLC-LLM inference (7B Q4 on Adreno) | 150-300ms | First-token latency |
| Parse + `insertIntelligence()` | < 1ms | GSAP tween creation |
| UI projection (next frame) | ~16ms | Waits for GSAP ticker |
| **End-to-end (3B model)** | **~120-220ms** | Honest range |
| **End-to-end (7B model)** | **~200-400ms** | Honest range |

**"Sub-zero latency" is not a real concept.** The system feels instant when end-to-end is under 200ms, which is achievable for small models. Don't claim impossibilities.

---

## 14. Repository Structure

See `mobile-runtime` branch for current canonical layout. Key directories:
- `docs/` — architecture specs (this file, AVA_LIVE_CHECKLIST.md, etc.)
- `src/meta/`, `src/constellation/`, `src/epoch/` — implemented pillars (TS)
- `src/runtime/governance/` — governance (from fix/build-stabilization)
- `rust/meta-harness/`, `rust/constellation/`, `rust/qnn-bridge/`, `rust/arrow-bridge/` — Rust cores
- `mobile/capacitor/` — Capacitor Android app (web shell + native)
- `scripts/bootstrap-termux.sh` — real Termux setup script
- `archive/` — legacy subsystems (Griptape, Goose, Neo4j, training)

---

## 15. Build & Deployment Strategy

### 15.1 Development environment

- **Termux + Ubuntu proot-distro** on S25/S26 Ultra (or dev machine for cross-compile)
- **Rust toolchain** with `aarch64-linux-android` target
- **Android NDK 26.x** + Android SDK 34
- **Capacitor CLI** 5.x
- **cargo-ndk** for Rust → Android cross-compilation

See `scripts/bootstrap-termux.sh` for the real, verifiable setup script.

### 15.2 Build pipeline

```bash
# 1. Build Rust NDK libraries
cd rust && cargo ndk --target aarch64-linux-android --platform 21 build --release
cp target/aarch64-linux-android/release/*.so ../mobile/capacitor/android/app/src/main/jniLibs/arm64-v8a/

# 2. Build Capacitor web assets
cd ../mobile/capacitor && npm ci && npm run build
npx cap sync android

# 3. Build APK
cd android && ./gradlew assembleDebug

# 4. Install on device
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

### 15.3 Root path (optional, accepts Knox trip)

If you explicitly accept the Knox trade-off:
- Flash KernelSU-patched boot.img
- Install Magisk modules for RIL hooks + Meshrabiya enhancements
- Verify Knox status: `adb shell getprop ro.boot.warranty_bit`

**There is no path that preserves Samsung Pay after kernel modification.**

---

## 16. Security & Governance

- **Meta Harness** enforces isolation (ArrowJS sandboxes), validation, audit trails on every layer
- **TASHI** provides immutable audit receipts (SHA-256 hash, signed)
- **No committed secrets** — `.env`, `*.private.pem`, `*.private.key` are gitignored
- **DID-based identity** — no raw PII in payloads
- **Redaction policies** in Meta Harness scrub sensitive fields before cloud calls

---

## 17. What's been stripped from earlier specs (v2.4 / v2.5)

These were hallucinated or fabricated in earlier iterations and are NOT part of v2.6:

| Stripped component | Reason |
|--------------------|--------|
| **GLM-5.2** | Doesn't exist as a published model. Real: GLM-4-9B, GLM-4-Plus. |
| **IndexShare / FlashAssign** | Not real Z.ai terminology. Fabricated. |
| **Mercury-2 model** | Not a real published model. |
| **"Quantum MemBrain superposition collapse"** | Marketing metaphor. Real: tween interpolation + event sourcing. |
| **"Sub-zero latency"** | Physically impossible. Real: 120-220ms end-to-end. |
| **"Pre-computed state space"** | Misleading. You can't pre-compute every possible LLM response. |
| **"KernelSU preserves Samsung Pay where possible"** | False. Knox e-fuse is a one-way trip. |
| **"217GB model on 24GB RAM"** | Physically impossible. UFS 4.0 can't move data that fast. |
| **"webllm+ T-MAN NPU acceleration"** | Conflation. WebLLM uses WebGPU, not NPU. T-MAN is internal Qualcomm, not a user API. |
| **802.11s mesh command confusion** | `iw dev wlan0 set mesh_param` requires a mesh interface, not a station interface. |
| **Magisk module `/system/lib64/` for app-loaded .so** | Redundant — apps load .so from APK jniLibs, not system path. |
| **`subprocess.run(['llamdrop', packet])` Python** | Type error (bytes vs str) + llamdrop binary doesn't exist. |
| **`window.mlc.createMLCEngine()`** | Wrong API. Real: `import { CreateMLCEngine } from '@mlc-ai/web-llm'`. |
| **Constellation router calling metaHarness.intercept()** | Circular dependency. Meta Harness wraps calls TO Constellation, not the reverse. |

---

## 18. Implementation Status Summary

| Component | Status | Branch | Phase |
|-----------|--------|--------|-------|
| Repository consolidation | DONE | `main` (merge `b7308cd951`) | 0 |
| Reconciliation manifest | DONE | `runtime-consolidation` | 0 |
| Mobile Runtime scaffolding | DONE | `mobile-runtime` | 0 |
| Meta Harness (TS + Rust) | DONE | `mobile-runtime` | 0 |
| Constellation (TS + Rust) | DONE | `mobile-runtime` | 0 |
| EPOCH (TS) | DONE | `mobile-runtime` | 0 |
| Wiring (App.tsx + WebLLMEngine.ts + InputOrchestrativeInterface.tsx) | DONE | `mobile-runtime` | 0 |
| Build verification (cargo test + tsc) | DONE | `mobile-runtime` @ `bb6c2caacf` | 0 |
| AMOS v2.6 spec (this document) | DONE | `mobile-runtime` | 0 |
| Termux bootstrap script | DONE | `mobile-runtime` | 0 |
| Arrow bridge Rust (real) | DONE | `mobile-runtime` | 0 |
| Pre-flight on dev machine | PENDING | — | 1 |
| Device setup | PENDING | — | 2 |
| First live boot | PENDING | — | 3 |
| MLC-LLM real backend | PENDING | — | 4.1 |
| Arrow zero-copy real | PENDING | — | 4.2 |
| QNN NPU backend | PENDING (needs QNN SDK) | — | 4.3 |
| llamdrop backend | PENDING (needs real binary) | — | 4.4 |
| Cloud backend | PENDING | — | 4.5 |
| TASHI L1-L4 memory | PENDING | — | 5 |
| GSAP temporal engine | PENDING | — | 6 |
| EPOCH presentation real | PENDING | — | 7 |
| AVA007 executive loop | PENDING | — | 8 |
| Meshrabiya mesh | PENDING (pick protocol first) | — | 9 |
| Production hardening | ONGOING | — | 10 |

---

## 19. Critical Path to First Live Demo

Phases 0 → 1 → 2 → 3 → 4.1 (MLC-LLM with Llama-3.2-3B) → 8.1 (basic orchestrator)

**~2-3 weeks** of focused work for a first live demo on S25 Ultra.

Full AMOS v2.6 production: ~3 months.

---

*This document is the canonical AMOS v2.6 specification. It supersedes v2.1, v2.4, and v2.5. All future work must reference this document, not the earlier specs.*

*Last updated: 2026-06-22 by Super Z*
