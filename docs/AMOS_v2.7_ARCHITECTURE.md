# AVA007 / QAG_MemBrain: Sovereign Agentic Mobile Operating System (AMOS)
## Architecture Specification — Version 2.7 (Injection-Centric + SDK-Free)

**Date:** June 2026
**Target Platforms:** Samsung Galaxy S25 Ultra / S26 Ultra (Snapdragon 8 Elite)
**Status:** Implementation-Ready (replaces v2.1 / v2.4 / v2.5 / v2.6)
**Source branch:** `mobile-runtime`

> **What changed from v2.6:**
> 1. Reframes the runtime as **injection-centric** — `insertIntelligence()` is
>    the primary operation; the GSAP timeline is the deterministic audit/replay
>    layer, NOT the cognitive driver.
> 2. Replaces the `webllm + T-MAN` claim with a **SDK-free GPU/NPU stack**:
>    Vulkan compute → NNAPI → CPU fallback. No Qualcomm QNN SDK. No Knox trip.
> 3. Clarifies the role split between `MlcLlmBackend` (native Vulkan via
>    `llama.cpp`) and `WebLlmBackend` (browser WebGPU via `@mlc-ai/web-llm`).
> 4. Locks in 802.11s as the mesh protocol (not WiFi Direct).

---

## 1. Executive Summary

AVA007 is a **Sovereign Agentic Mobile Operating System** for the Samsung Galaxy
S25/S26 Ultra. It runs as a device-native intelligence layer with **AVA007** as
the sole executive authority.

AVA007 is an **injection-first cognitive runtime**: every decision, perception,
and action is an `insertIntelligence()` call that mutates the state manifold.
The GSAP timeline is the **deterministic audit trail** of those injections —
the replay layer, not the operating principle.

Every subsystem interaction is wrapped by the **Meta Harness** (universal
interceptor) and routed through **Constellation** (dynamic model + backend
router). All inference uses **standard Android APIs** (Vulkan, NNAPI) — no
proprietary SDKs, no Knox trip.

### Design principles

1. **Injection-first.** `insertIntelligence(target, vars)` is the primary
   operation. State mutation drives the runtime, not the other way around.
2. **Timeline is audit.** `recallState(t)` reconstructs past state from
   GSAP tween definitions + audit events. The timeline is a side effect
   of injection, not the executive.
3. **Local-first.** Hot path runs entirely on-device. Cloud is opt-in, gated by policy.
4. **Nothing bypasses Meta Harness.** Every subsystem call is observed, validated, governed, audited.
5. **Honest latency targets.** 120-220ms end-to-end for typical sensor→quote loops. No "sub-zero" claims.
6. **SDK-free GPU/NPU.** Vulkan + NNAPI + CPU fallback. No Qualcomm QNN SDK. No Knox trip.
7. **Real models only.** Models are real artifacts on HuggingFace that work on Adreno via MLC-LLM / llama.cpp Vulkan.

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
Subconscious    Planning        Execution      Memory         Presentation
(read-only)     (on-demand)     (tools)        (audit + L0-L4) (ArrowJS + GSAP)
```

**Nothing bypasses AVA007 or Meta Harness.** All cross-pillar calls flow
through `metaHarness.intercept({ pillar, operation, payload, execute })`.

### REV.IKE — Subconscious (read-only interpreter)

Per the architect's directive: **REV.IKE = Subconscious**.
- Perceives, frames, interprets
- Does NOT mutate state (no "Preview then Commit" authority)
- Hands off to AVA007 (L6 conscious executive) for any decision requiring mutation
- The "sub-20ms reflex layer" framing in earlier specs was the coder's
  misinterpretation — Subconscious is the canonical concept

---

## 3. Canonical Pillars

| Pillar | Responsibility | Hot path? | Status |
|--------|----------------|-----------|--------|
| **AVA007** | Executive: task routing, priority scheduling, final synthesis. Issues `insertIntelligence()` calls. | Always | Wired |
| **Meta Harness** | Universal interceptor: observe, validate, policy, audit | Always | Implemented |
| **Constellation** | Dynamic backend selection: Vulkan/NNAPI/CPU/Cloud | Always | Implemented |
| **REV.IKE** | Subconscious — read-only interpreter, perceives/frames | Always | Stub (Phase 8) |
| **FABLE** | System-2 planning for complex tasks | On-demand | Stub (Phase 8) |
| **FAPO** | Pipeline-aware prompt optimization | On-demand | Stub (Phase 8; concept unverified) |
| **GOOSE** | Pure execution layer (tool calls) | On-demand | Stub (Phase 8) |
| **TASHI** | Persistent memory: L0 RAM → L1 JSONL → L2 DuckDB → L3 GraphRAG → L4 archive | Always | Partial (audit logger wired; L1-L4 stub) |
| **GSAP Temporal** | Audit trail + deterministic replay (`recallState(t)`) | Always | Stub (Phase 6) |
| **EPOCH** | ArrowJS Sandbox + GSAP UI rendering | Always | Stub (Phase 7) |
| **Mobile Runtime** | Capacitor + NDK/Rust + Arrow zero-copy | Always | Scaffolding |
| **Vibe Thinker** | On-demand specialist for deep reasoning | On-demand | Stub (Phase 8) |

---

## 4. Intelligence Flow (injection-centric)

Ava receives intelligence through a layered pipeline. Each layer culminates in
an `insertIntelligence()` call that mutates the state manifold.

### 4.1 The seven layers

| Layer | What Ava receives | Where it lives | Real example |
|-------|-------------------|----------------|--------------|
| **Sensory** | Raw bytes (BLE, image, audio, GPS) | S25 Ultra hardware | BLE beacon broadcast: `productId: "ikea-bed-001"` |
| **Ingestion** | Structured SemanticPacket | S25 → mesh → S26 (or local) | `{ nodeId, intent, context, confidence, timestamp, semanticWeight }` |
| **Cognitive** | Natural language from LLM | Local llama.cpp Vulkan on Adreno | "IKEA MALM Bed Frame, $146, Medium difficulty" |
| **Orchestration** | `insertIntelligence(quote, {...})` — state mutation | AVA007 executive | `{ product, price: 146, difficulty: "Medium", addOns: [...] }` |
| **Temporal** | TweenAtom appended to GSAP timeline (audit side-effect) | Browser masterTimeline | Recorded automatically when `insertIntelligence` is called |
| **Persistent** | Research atom (immutable insight, signed) | TASHI L1 JSONL → L2 DuckDB | Atom ID with SHA-256 hash |
| **Projection** | UI + dispatch | Browser + A2A mesh | Quote card rendered via ai2ui-projector; A2A-BEEP dispatches to technician |

### 4.2 Live example (grounded numbers)

```
1. BLE beacon broadcasts productId="ikea-bed-001"
2. S25 BleconBridge.kt packages as SemanticPacket (< 1ms)
3. WebSocket send to S26 (or local if S25-only) (2-5ms on local hotspot)
4. llama.cpp Vulkan inference on Adreno GPU (60-200ms depending on model size)
5. AVA007 calls insertIntelligence(quote, { duration: 0.5, ease: 'power2.out' })
   → State mutated, tween appended to GSAP timeline as audit (< 1ms)
6. UI projection on next GSAP ticker frame (~16ms)
7. Total: 80-220ms end-to-end
```

**No cloud round-trip. No retraining. Deterministic and replayable.**

### 4.3 What Ava never receives

- ❌ Raw API keys (env vars only; never in payload)
- ❌ Unstructured data (everything parsed before injection)
- ❌ User PII directly (DID-based identity)
- ❌ Cloud model updates without explicit policy approval

### 4.4 The two primary operations

```typescript
// PRIMARY: Mutate the state manifold. Every decision, perception, and action
// flows through this. The GSAP timeline is updated as a SIDE EFFECT.
insertIntelligence(target: string, vars: TweenVars): void;

// SECONDARY: Reconstruct past state at time t from the audit trail.
// Used for replay, debugging, and "what did Ava know at time T?" queries.
recallState(t: number): ManifoldSnapshot;
```

The timeline does NOT drive the runtime. It records the runtime. This is the
injection-centric model — state mutation is primary, audit is secondary.

---

## 5. Backend Stack (Constellation) — SDK-Free

Constellation routes each inference request to the optimal backend based on
budget, latency, battery, thermal, and privacy constraints.

### 5.1 SDK-free backend priority

| Backend | Use case | Hardware | Knox Impact | Real API |
|---------|----------|----------|-------------|----------|
| **llama.cpp Vulkan** (primary) | AVA007 core runtime | Adreno GPU (Vulkan compute) | ✅ None | `ggml-vulkan` in llama.cpp main tree |
| **NNAPI delegate** (secondary) | NPU when available, GPU/CPU fallback | Hexagon NPU + Adreno + CPU | ✅ None | Android NNAPI (API 27+) via TFLite |
| **CPU** (fallback) | When GPU/NPU throttled | CPU | ✅ None | `llama.cpp` CPU backend |
| **Cloud API** (optional) | When `requireLocal === false` | Network | ✅ None | GLM-4-Plus, GPT-4o, Claude 3.5 Sonnet (via API) |
| **WebLLM** (browser-only, isolated) | ArrowJS Sandbox + EPOCH UI agents | Adreno GPU (WebGPU) | ✅ None | `@mlc-ai/web-llm` (browser package) |
| ~~QNN SDK~~ | ❌ DROPPED | Hexagon NPU | ⚠️ May trip Knox | Requires vendor approval |
| ~~SNPE~~ | ❌ DROPPED | Hexagon NPU | ⚠️ May trip Knox | Proprietary |
| ~~Custom kernel modules~~ | ❌ DROPPED | Various | ❌ Trips Knox | Requires root |

### 5.2 Why llama.cpp Vulkan (not @mlc-ai/web-llm) for primary path

`@mlc-ai/web-llm` (which Phase 4.1 integrated into `MlcLlmBackend.ts`) uses
**WebGPU**, which is browser-only. That's fine for the **EPOCH UI / sandbox
path** (`WebLlmBackend.ts`), but for **AVA007's primary local path**, we need
native GPU access without the browser overhead.

**`llama.cpp` with Vulkan backend** is the right primary:
- Native `.so` compiled via NDK, no browser required
- Uses `ggml-vulkan` — standard Vulkan compute shaders
- No Qualcomm SDK, no Knox trip
- Same models work (Llama-3.2-3B Q4, Gemma-2-2B Q4, etc. via GGUF format)
- Real, maintained, in main llama.cpp tree

### 5.3 Real model selection (NOT GLM-5.2)

The "GLM-5.2" mentioned in earlier specs does not exist. Real models that work
on Adreno today via Vulkan or WebGPU:

**For llama.cpp Vulkan (primary path, native .so):**
- Llama-3.2-3B-Instruct-Q4_K_M.gguf (~2 GB)
- gemma-2-2b-it-Q4_K_M.gguf (~1.5 GB)
- Qwen2.5-7B-Instruct-Q4_K_M.gguf (~4.5 GB)
- Llama-3.1-8B-Instruct-Q4_K_M.gguf (~5 GB)

**For @mlc-ai/web-llm (secondary path, browser):**
- Llama-3.2-3B-Instruct-q4f16_1-MLC
- gemma-2-2b-it-q4f16_1-MLC
- Qwen2.5-7B-Instruct-q4f16_1-MLC

**For Z.ai GLM (cloud only, since GLM-5.2 doesn't exist):**
- GLM-4-9B-Chat Q4 (~5.5 GB, fits in S25 Ultra 12 GB RAM, real on HuggingFace)
- GLM-4-Plus (cloud-only via Z.ai API)

**Pick one. Drop "GLM-5.2" entirely.**

### 5.4 Constellation routing algorithm

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
| **L0** | Current session state in RAM (the manifold) | < 1ms | Process lifetime |
| **L1** | Audit events as JSONL (one per `insertIntelligence` call) | < 5ms | Filesystem (rotated) |
| **L2** | DuckDB Context Lake (events indexed, queryable) | < 50ms | Persistent (DuckDB files) |
| **L3** | GraphRAG (entity relationships, semantic edges) | < 200ms | Persistent (Neo4j or DuckDB graph) |
| **L4** | Gists / archive (compressed long-term memory) | seconds | Cold storage |

### 6.1 Audit receipts — tied to `insertIntelligence`

Every `insertIntelligence()` call emits a TASHI audit receipt containing:
- Unique `traceId` linking the injection to its audit trail
- `target`, `vars`, `timestamp`
- SHA-256 hash of the canonical event JSON (Web Crypto API)
- Optional error / result summary
- TASHI receipt ID for cross-referencing

### 6.2 Replay — `recallState(t)`

State is reconstructed from the audit trail, not recomputed. `recallState(t)`
returns the interpolated state at time `t` by reading GSAP tween definitions
+ replaying audit events. This is deterministic — same `t` always yields same
state.

**This is NOT quantum superposition.** It's tween interpolation + event
sourcing — a well-established pattern. The timeline is the audit; the
injection is the operation.

---

## 7. Zero-Copy Pipeline

```
LiteParse WASM → Rust → Apache Arrow C Data Interface → JNI → ArrowJS Sandbox →
Meta Harness validation → AVA007.insertIntelligence() → GSAP audit + EPOCH render → Adreno GPU
```

### 7.1 Real implementation status

- `rust/arrow-bridge/` — real types + export registry. The `arrow` feature
  flag gates the actual Arrow C Data Interface code.
- `mobile/capacitor/android/app/src/main/cpp/arrow_jni.cpp` — JNI shim that
  calls into `rust/arrow-bridge/` via `libarrow_jni.so`.
- `mobile/capacitor/src/services/DocumentParser.ts` — placeholder for
  LiteParse WASM integration.

### 7.2 True zero-copy

The "zero-copy" claim requires care:
- Arrow `Float32Array::from_raw_parts(ptr, len)` is zero-copy IF you control the source memory lifetime
- JNI's `get_float_array_elements(ReleaseMode::NoCopyBack)` gives a borrowed view — also zero-copy
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

### 8.2 Native Activities (non-root path — RECOMMENDED)

Android Native Activities give direct access to:
- **Adreno GPU via Vulkan** (compute shaders — no SDK, no Knox trip)
- **Adreno GPU via OpenCL** (via `libOpenCL.so`, available on most devices)
- **Hexagon NPU via NNAPI** (Android standard API 27+, falls back to GPU/CPU)
- **Bluetooth LE** (via `android.bluetooth.*`)
- **Audio** (via Oboe/AAudio)

**No Knox trip. No vendor SDK.** This is the recommended path for all
development and most production deployments.

### 8.3 KernelSU (optional root path — accepts Knox trip)

KernelSU / SUSFS on patched boot.img gives:
- Kernel-level signing for TASHI L2 Trust Layer
- Direct RIL hooks for Meshrabiya network sovereignty
- Memory remapping for performance-critical paths

**WARNING:** Installing KernelSU **trips the Knox e-fuse permanently**. Samsung
Pay, Secure Folder, most enterprise MDM, and warranty are gone forever. There
is no "preserve Samsung Pay where possible" — Knox is a one-way fuse. Only do
this if you've explicitly accepted the trade-off.

---

## 9. Network Sovereignty (Meshrabiya)

### 9.1 Protocol choice: 802.11s (LOCKED IN)

Per the architect's directive: **802.11s for true mesh**.

| Protocol | Range | Bandwidth | Root needed? | Status |
|----------|-------|-----------|--------------|--------|
| **802.11s mesh** | ~100m | High | Yes (interface creation) | ✅ LOCKED IN — primary |
| WiFi Direct (P2P) | ~100m | High | No | Available as fallback |
| BLE GATT | ~10m | Low | No | Available for short-range |
| LoRa | ~10km | Very low | No (USB dongle) | Available for long-range |

802.11s provides true multi-hop mesh (each node forwards packets for
neighbors). WiFi Direct is only point-to-point.

**Implementation note:** Standard Linux `iw` commands work but require root
to create a mesh interface (`iw dev wlan0 interface add mesh0 type mp`).
Non-root fallback uses `WifiP2pManager` Android API (point-to-point only).

### 9.2 Cloudflare Mesh + WARP (cloud overlay)

Cloudflare Tunnel + WARP provide private mesh IP, client-to-client D2D, and
carrier-bypass tunneling. **Real, no root needed.** Configure via
`wrangler.toml` + Cloudflare WARP client.

---

## 10. Data Ocean + Context Lake

| Layer | Technology | Status |
|-------|------------|--------|
| Ingestion | WebDAV → Cloudflare Pipelines | Stub (Phase 5) |
| Storage | Apache Iceberg on Cloudflare R2 | Stub |
| Analytical core | DuckDB with native Iceberg support | Stub (DuckDB Context Lake is L2 of TASHI) |
| Holographic reconstruction | `recallState(t)` uses Iceberg snapshots | Stub (Phase 6) |

**Note:** "Zero egress" via R2 is real for R2→R2 transfers. R2→client still has bandwidth costs.

---

## 11. FAPO (Pipeline-Aware Prompt Optimization) — UNVERIFIED

FAPO is referenced in a MarkTechPost article from June 2026 as a Cisco AI
research concept. The article is behind a Cloudflare challenge and I could not
directly verify it on Cisco's research blog or arXiv. Treat FAPO as
**plausible but unverified** until primary source is confirmed.

### 11.1 Where FAPO fits in AMOS

If verified, FAPO would be an **on-demand specialist** invoked by FABLE when:
- A multi-step pipeline fails at a specific step
- FABLE needs to optimize prompts for retry

FAPO is NOT in the hot path. It's a debugging/optimization tool for FABLE's
planning layer.

### 11.2 Implementation status

Not implemented. Pending verification of the source paper.

---

## 12. Vibe Thinker Integration

[VibeThinker-3B](https://huggingface.co/WeiboAI/VibeThinker-3B) is a real
3B-parameter model from WeiboAI, fine-tuned from Qwen2.5-Coder-3B for
verifiable reasoning (math, code, STEM). Per the model card:
- ❌ Not trained on tool-calling or agent-based programming
- ❌ Not recommended for function calling or autonomous coding agents
- ✅ Strong on LeetCode-style problems (96.1% pass rate on recent contests)
- ✅ Strong on IMO-AnswerBench (76.4 → 80.6 with CLR)

### 12.1 Where Vibe Thinker fits in AMOS

**On-demand specialist**, not in the always-running path. Invoked by FABLE
only when:
- Task requires deep architectural reasoning
- Multi-agent planning needs verifiable math/code sub-tasks
- Long engineering sessions need a specialist that can verify its own answers

### 12.2 Implementation status

Not implemented. Phase 8 of Ava Live checklist. When integrated, will run as a
separate `llama.cpp` Vulkan model instance, loaded on-demand to preserve RAM.

---

## 13. Latency Targets (grounded)

| Operation | Target | Notes |
|-----------|--------|-------|
| BLE scan → product ID | 30-50ms | Hardware interrupt, no OS scheduling |
| SemanticPacket serialization | < 1ms | JSON in native Kotlin |
| WebSocket send (local hotspot) | 2-5ms | Assumes S25 ↔ S26 on same hotspot |
| llama.cpp Vulkan (3B Q4 on Adreno) | 60-150ms | First-token latency |
| llama.cpp Vulkan (7B Q4 on Adreno) | 150-300ms | First-token latency |
| NNAPI NPU (3B Q4 on Hexagon) | 50-100ms | When available; falls back to GPU |
| `insertIntelligence()` + audit log | < 1ms | Tween append + TASHI receipt emit |
| UI projection (next frame) | ~16ms | Waits for GSAP ticker |
| **End-to-end (3B model)** | **~120-220ms** | Honest range |
| **End-to-end (7B model)** | **~200-400ms** | Honest range |

**"Sub-zero latency" is not a real concept.** The system feels instant when
end-to-end is under 200ms, which is achievable for small models on Vulkan.
Don't claim impossibilities.

---

## 14. Repository Structure

See `mobile-runtime` branch for current canonical layout. Key directories:
- `docs/` — architecture specs (this file, AVA_LIVE_CHECKLIST.md, etc.)
- `src/meta/`, `src/constellation/` (incl. `backends/`), `src/epoch/` — implemented pillars (TS)
- `src/subconscious/rev_ike/` — Subconscious (REV.IKE) pillar
- `src/memory/tashi/` — TASHI memory
- `src/runtime/governance/` — governance
- `rust/meta-harness/`, `rust/constellation/`, `rust/qnn-bridge/`, `rust/arrow-bridge/` — Rust cores
- `mobile/capacitor/` — Capacitor Android app (web shell + native)
- `mobile/capacitor/android/app/src/main/cpp/vulkan/` — Vulkan compute POC (NEW in v2.7)
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
- **llama.cpp** built with `-DGGML_VULKAN=ON` for primary inference path

See `scripts/bootstrap-termux.sh` for the real, verifiable setup script.

### 15.2 Build pipeline

```bash
# 1. Build Rust NDK libraries
cd rust && cargo ndk --target aarch64-linux-android --platform 21 build --release
cp target/aarch64-linux-android/release/*.so ../mobile/capacitor/android/app/src/main/jniLibs/arm64-v8a/

# 2. Build llama.cpp with Vulkan backend (primary inference path)
cd /path/to/llama.cpp
mkdir build && cd build
cmake .. -DGGML_VULKAN=ON -DCMAKE_TOOLCHAIN_FILE=$NDK_HOME/build/cmake/android.toolchain.cmake \
  -DANDROID_ABI=arm64-v8a -DANDROID_PLATFORM=android-24
make -j llama
cp libllama.so libggml*.so $REPO/mobile/capacitor/android/app/src/main/jniLibs/arm64-v8a/

# 3. Build Vulkan compute shader POC (proof of SDK-free GPU access)
cd $REPO/mobile/capacitor/android/app/src/main/cpp/vulkan
# (See vulkan/README.md for build instructions)

# 4. Build Capacitor web assets
cd $REPO/mobile/capacitor && npm ci && npm run build
npx cap sync android

# 5. Build APK
cd android && ./gradlew assembleDebug

# 6. Install on device
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
- **TASHI** provides immutable audit receipts (SHA-256 hash, signed) for every `insertIntelligence()` call
- **No committed secrets** — `.env`, `*.private.pem`, `*.private.key` are gitignored
- **DID-based identity** — no raw PII in payloads
- **Redaction policies** in Meta Harness scrub sensitive fields before cloud calls
- **No vendor SDK** — Vulkan + NNAPI + CPU only. No Qualcomm QNN. No SNPE.

---

## 17. What's been stripped from earlier specs (v2.4 / v2.5 / v2.6)

These were hallucinated, fabricated, or wrong in earlier iterations and are
NOT part of v2.7:

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
| **"webllm+ T-MAN NPU acceleration"** | Conflation. WebLLM uses WebGPU. T-MAN is internal Qualcomm. |
| **QNN SDK as primary path** | ❌ Replaced by llama.cpp Vulkan (no SDK, no Knox trip) |
| **SNPE** | ❌ Proprietary, dropped |
| **802.11s vs WiFi Direct confusion** | ✅ Resolved: 802.11s locked in as primary mesh protocol |
| **Magisk module `/system/lib64/` for app-loaded .so** | Redundant — apps load .so from APK jniLibs. |
| **`subprocess.run(['llamdrop', packet])` Python** | Type error + llamdrop binary doesn't exist. |
| **`window.mlc.createMLCEngine()`** | Wrong API. Real: `import { CreateMLCEngine } from '@mlc-ai/web-llm'`. |
| **Constellation router calling metaHarness.intercept()** | Circular dependency. Meta Harness wraps calls TO Constellation. |
| **REV.IKE as "sub-20ms reflex layer"** (v2.6 mischaracterization) | Corrected: REV.IKE = Subconscious (read-only interpreter). |
| **GSAP timeline as cognitive driver** (v2.6 mischaracterization) | Corrected: timeline is audit; `insertIntelligence()` is the operation. |

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
| Backend split (BackendExecutor interface) | DONE | `mobile-runtime` | 4.1 |
| MlcLlmBackend (real @mlc-ai/web-llm for sandbox path) | DONE | `mobile-runtime` | 4.1 |
| WebLlmBackend (real @mlc-ai/web-llm for sandbox path) | DONE | `mobile-runtime` | 4.1 |
| LlamdropBackend (CPU fallback stub) | DONE | `mobile-runtime` | 4.1 |
| CloudBackend (optional stub) | DONE | `mobile-runtime` | 4.1 |
| AMOS v2.7 spec (this document) | DONE | `mobile-runtime` | 0 |
| Vulkan compute POC | DONE | `mobile-runtime` | 0 |
| Pre-flight on dev machine | PENDING | — | 1 |
| Device setup | PENDING | — | 2 |
| First live boot | PENDING | — | 3 |
| **llama.cpp Vulkan backend integration** (primary path) | PENDING | — | 4.1 |
| Arrow zero-copy real | PENDING | — | 4.2 |
| NNAPI delegate integration | PENDING | — | 4.3 |
| llamdrop backend | PENDING (needs real binary) | — | 4.4 |
| Cloud backend real | PENDING | — | 4.5 |
| TASHI L1-L4 memory | PENDING | — | 5 |
| GSAP temporal engine | PENDING | — | 6 |
| EPOCH presentation real | PENDING | — | 7 |
| AVA007 executive loop | PENDING | — | 8 |
| Meshrabiya mesh (802.11s) | PENDING | — | 9 |
| Production hardening | ONGOING | — | 10 |

---

## 19. Critical Path to First Live Demo

Phases 0 → 1 → 2 → 3 → 4.1 (llama.cpp Vulkan with Llama-3.2-3B) → 8.1 (basic orchestrator)

**~2-3 weeks** of focused work for a first live demo on S25 Ultra.

Full AMOS v2.7 production: ~3 months.

---

*This document is the canonical AMOS v2.7 specification. It supersedes v2.1,
v2.4, v2.5, and v2.6. All future work must reference this document.*

*Last updated: 2026-06-23 by Super Z (per architect's directive)*
