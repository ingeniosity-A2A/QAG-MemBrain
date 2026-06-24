# AVA007 / QAG_MemBrain: Sovereign Agentic Mobile Operating System (AMOS)
## Architecture Specification — Version 2.8 (Gemma 2B + Native Mesh + Phone Coexistence)

**Date:** June 2026
**Target Platforms:** Samsung Galaxy S25 Ultra / S26 Ultra (Snapdragon 8 Elite)
**Status:** Implementation-Ready (replaces v2.1 / v2.4 / v2.5 / v2.6 / v2.7)
**Source branch:** `mobile-runtime`

> **What changed from v2.7:**
> 1. **Primary inference = Gemma 2B (already on device)** — sovereign, open-weight,
>    no download, runs via `llama.cpp` Vulkan backend. Drops the "download
>    Llama-3.2-3B" framing.
> 2. **Mesh = WiFi Aware (NAN) primary, WiFi Direct fallback** — drops 802.11s
>    because 802.11s requires root and root trips Knox. WiFi Aware is a standard
>    Android API (26+), no root, true peer-to-peer without infrastructure.
> 3. **NEW section: Phone integration via standard Android APIs** — AVA007
>    coexists with the phone stack (CallScreeningService, InCallService,
>    PhoneStateListener). Phone calls = income; cannot be disrupted.
> 4. **DROP KernelSU section entirely** — Knox preservation is a HARD constraint,
>    not a trade-off. Phone calls must keep working.
> 5. **Cloud overlay = Cloudflare WARP via VpnService** — standard Android API,
>    no root, no Knox trip.

---

## 1. Executive Summary

AVA007 is a **Sovereign Agentic Mobile Operating System** for the Samsung Galaxy
S25/S26 Ultra. It runs as a device-native intelligence layer with **AVA007** as
the sole executive authority.

AVA007 is an **injection-first cognitive runtime**: every decision, perception,
and action is an `insertIntelligence()` call that mutates the state manifold.
The GSAP timeline is the **deterministic audit trail** of those injections.

Every subsystem interaction is wrapped by the **Meta Harness** (universal
interceptor) and routed through **Constellation** (dynamic model + backend
router). Primary inference runs on **Gemma 2B** (already installed on device
via Ubuntu proot) via **`llama.cpp` Vulkan backend** — sovereign, no Google
dependency, no Knox trip, no download.

**Critical constraint: Knox must stay intact.** Phone calls = income. If Knox
trips, Samsung Pay, VoLTE, carrier features break, income stops. Every
architectural decision must preserve Knox.

### Design principles

1. **Injection-first.** `insertIntelligence(target, vars)` is the primary operation.
2. **Timeline is audit.** `recallState(t)` reconstructs past state from GSAP tween definitions + audit events.
3. **Local-first.** Hot path runs entirely on-device. Cloud is opt-in, gated by policy.
4. **Nothing bypasses Meta Harness.** Every subsystem call is observed, validated, governed, audited.
5. **Honest latency targets.** 120-220ms end-to-end for typical sensor→quote loops.
6. **SDK-free GPU/NPU.** Vulkan + NNAPI + CPU fallback. No Qualcomm QNN SDK. No Knox trip.
7. **Real models only.** Gemma 2B already on device. Real artifacts, real APIs.
8. **Knox preservation is HARD constraint, not trade-off.** Phone calls = income. Root paths forbidden.

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

---

## 3. Canonical Pillars

| Pillar | Responsibility | Hot path? | Status |
|--------|----------------|-----------|--------|
| **AVA007** | Executive: task routing, priority scheduling, final synthesis. Issues `insertIntelligence()` calls. | Always | Wired |
| **Meta Harness** | Universal interceptor: observe, validate, policy, audit | Always | Implemented |
| **Constellation** | Dynamic backend selection: Gemma/Vulkan/NNAPI/CPU/Cloud | Always | Implemented |
| **REV.IKE** | Subconscious — read-only interpreter, perceives/frames | Always | Stub (Phase 8) |
| **FABLE** | System-2 planning for complex tasks | On-demand | Stub (Phase 8) |
| **FAPO** | Pipeline-aware prompt optimization | On-demand | Stub (Phase 8; concept unverified) |
| **GOOSE** | Pure execution layer (tool calls) | On-demand | Stub (Phase 8) |
| **TASHI** | Persistent memory: L0 RAM → L1 JSONL → L2 DuckDB → L3 GraphRAG → L4 archive | Always | Partial |
| **GSAP Temporal** | Audit trail + deterministic replay (`recallState(t)`) | Always | Stub (Phase 6) |
| **EPOCH** | ArrowJS Sandbox + GSAP UI rendering | Always | Stub (Phase 7) |
| **Mobile Runtime** | Capacitor + NDK/Rust + Arrow zero-copy | Always | Scaffolding |
| **Phone Coexistence** | CallScreeningService + InCallService + PhoneStateListener | Always | NEW (Phase 4.5) |
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
| **Cognitive** | Natural language from LLM | **Gemma 2B via `llama.cpp` Vulkan on Adreno** | "IKEA MALM Bed Frame, $146, Medium difficulty" |
| **Orchestration** | `insertIntelligence(quote, {...})` — state mutation | AVA007 executive | `{ product, price: 146, difficulty: "Medium", addOns: [...] }` |
| **Temporal** | TweenAtom appended to GSAP timeline (audit side-effect) | Browser masterTimeline | Recorded automatically when `insertIntelligence` is called |
| **Persistent** | Research atom (immutable insight, signed) | TASHI L1 JSONL → L2 DuckDB | Atom ID with SHA-256 hash |
| **Projection** | UI + dispatch | Browser + A2A mesh | Quote card rendered via ai2ui-projector; A2A-BEEP dispatches to technician |

### 4.2 Live example (grounded numbers)

```
1. BLE beacon broadcasts productId="ikea-bed-001"
2. S25 BleconBridge.kt packages as SemanticPacket (< 1ms)
3. WebSocket send to S26 (or local if S25-only) (2-5ms on local hotspot)
4. Gemma 2B inference via llama.cpp Vulkan on Adreno GPU (50-150ms)
5. AVA007 calls insertIntelligence(quote, { duration: 0.5, ease: 'power2.out' })
   → State mutated, tween appended to GSAP timeline as audit (< 1ms)
6. UI projection on next GSAP ticker frame (~16ms)
7. Total: 70-220ms end-to-end
```

**No cloud round-trip. No retraining. Deterministic and replayable.**

### 4.3 The two primary operations

```typescript
// PRIMARY: Mutate the state manifold. Every decision, perception, and action
// flows through this. The GSAP timeline is updated as a SIDE EFFECT.
insertIntelligence(target: string, vars: TweenVars): void;

// SECONDARY: Reconstruct past state at time t from the audit trail.
recallState(t: number): ManifoldSnapshot;
```

The timeline does NOT drive the runtime. It records the runtime.

---

## 5. Backend Stack (Constellation) — SDK-Free + Gemma 2B Primary

Constellation routes each inference request to the optimal backend based on
budget, latency, battery, thermal, and privacy constraints.

### 5.1 Backend priority (Gemma 2B primary)

| Backend | Use case | Hardware | Knox Impact | Status |
|---------|----------|----------|-------------|--------|
| **Gemma 2B via llama.cpp Vulkan** (PRIMARY) | AVA007 core runtime | Adreno GPU (Vulkan compute) | ✅ None | GemmaBackend.ts (NEW) |
| **NNAPI delegate** (secondary) | NPU when available | Hexagon NPU + Adreno + CPU | ✅ None | Stub |
| **CPU fallback** | When GPU throttled | CPU | ✅ None | LlamdropBackend.ts (stub) |
| **WebLLM** (browser-only, isolated) | ArrowJS Sandbox + EPOCH UI agents | Adreno GPU (WebGPU) | ✅ None | WebLlmBackend.ts |
| **Cloud API** (optional) | When `requireLocal === false` | Network | ✅ None | CloudBackend.ts (stub) |
| ~~QNN SDK~~ | ❌ DROPPED | Hexagon NPU | ⚠️ May trip Knox | — |
| ~~SNPE~~ | ❌ DROPPED | Hexagon NPU | ⚠️ May trip Knox | — |
| ~~Custom kernel modules~~ | ❌ DROPPED | Various | ❌ Trips Knox | — |

### 5.2 Why Gemma 2B is primary

- **Already installed on device** via Ubuntu proot — zero download, zero startup cost
- **Sovereign** — open-weight, no Google dependency, no API key, no telemetry
- **Real** — `gemma-2-2b-it-Q4_K_M.gguf` is a real model on HuggingFace
- **Fits in RAM** — ~1.5 GB Q4 quantization, leaves 10+ GB for the rest of AVA007
- **Fast on Adreno Vulkan** — 50-150ms first-token latency
- **No Knox trip** — `llama.cpp` uses standard Vulkan compute shaders

### 5.3 Why NOT Gemini Nano (despite being pre-installed)

Gemini Nano IS pre-installed on S25 Ultra (via Google AICore), and would be
even faster (zero load time, model already in AICore's process). But:

- **Not sovereign** — Google controls the model, API, and updates
- **Closed weights** — can't inspect, can't audit, can't swap
- **Google telemetry** — usage reporting back to Google
- **API instability** — Google can change/disable the API at any time

For AVA007's sovereignty mandate, Gemma 2B wins. Gemini Nano could be a future
opt-in "fast path" for users who don't mind Google dependency, but it's NOT the
default.

### 5.4 Real model options

**Primary — REV.IKE reflex path (always-on, hot path):**
- `gemma-2-2b-it-Q4_K_M.gguf` (~1.5 GB) — Gemma 2 2B Instruct, Q4_K_M quantization
  - Already on device (installed via Ubuntu proot per architect)
  - Fast: 50-150ms first-token on Adreno Vulkan
  - Used for: REV.IKE reflex, simple intent routing, quick responses

**FABLE — Planning path (on-demand, multi-step):**
- `gemma4-v2-Q4_K_M.gguf` (~7 GB) — Gemma 4 12B agentic fine-tune
  - Source: https://huggingface.co/yuxinlu1/gemma-4-12B-agentic-fable5-composer2.5-v2-3.5x-tau2-GGUF
  - Base: google/gemma-4-12B-it
  - Fine-tuned for: coding, agentic, terminal, tool-use, reasoning
  - Trained on Fable 5 traces (rebuilt with Opus 4.8)
  - 3.5× improvement over base on tau2-bench telecom (agentic tool use)
  - License: Apache 2.0 (sovereign-friendly)
  - Loaded on-demand by FABLE pillar when task complexity exceeds REV.IKE threshold
  - Unloaded after task completes (frees ~7 GB RAM)
  - Use Q3_K_M (~5.5 GB) on S25 Ultra 12 GB for more headroom
  - Download: `bash scripts/build-and-deploy.sh --with-fable`

**Optional (other models that work on Adreno):**
- `gemma-2-9b-it-Q4_K_M.gguf` (~5.5 GB) — Gemma 2 9B Instruct
- `Llama-3.2-3B-Instruct-Q4_K_M.gguf` (~2 GB)
- `Qwen2.5-7B-Instruct-Q4_K_M.gguf` (~4.5 GB)

**Forbidden (do not use):**
- ~~GLM-5.2~~ — doesn't exist
- ~~Mercury-2~~ — doesn't exist
- ~~217GB+ models~~ — physically impossible on 12-24 GB RAM

### 5.5 Multi-model RAM budget on S25 Ultra (12 GB)

| Component | RAM used |
|-----------|----------|
| Android OS + system services | ~2 GB |
| AVA007 runtime (Capacitor + Rust + Arrow buffers) | ~1 GB |
| Gemma 2B Q4_K_M (primary, always loaded) | ~1.5 GB |
| **Total with primary only** | **~4.5 GB** (7.5 GB free) |
| Gemma 4 12B Q4_K_M (FABLE, on-demand) | +~7 GB |
| **Total with FABLE loaded** | **~11.5 GB** (0.5 GB free — TIGHT) |

For S25 Ultra 12 GB: use FABLE Q3_K_M (~5.5 GB) to leave 2 GB headroom.
For S26 Ultra 16 GB+: Q4_K_M is comfortable.
For S26 Ultra 24 GB: Q4_K_M + Q8_0 MTP variant for maximum quality.

### 5.6 Constellation routing algorithm

Implemented in `src/constellation/Router.ts`. Decision flow:
1. Filter backends by HealthChecker status
2. Filter by `requireLocal` (skip cloud if true)
3. Compute BudgetEstimate per backend
4. Apply hard constraints from `Budget`
5. Score survivors: `score = 0.4 * latency_fit + 0.3 * battery_fit + 0.3 * quality`
6. Pick highest score; return RoutingDecision + alternatives

Default Router policy on S25 Ultra: pick GemmaBackend (highest score because
model is pre-loaded, lowest latency).

---

## 6. Memory Hierarchy (TASHI)

Five-level memory hierarchy.

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
- TASHI receipt ID for cross-referencing

### 6.2 Replay — `recallState(t)`

State is reconstructed from the audit trail, not recomputed. Deterministic —
same `t` always yields same state.

---

## 7. Zero-Copy Pipeline

```
LiteParse WASM → Rust → Apache Arrow C Data Interface → JNI → ArrowJS Sandbox →
Meta Harness validation → AVA007.insertIntelligence() → GSAP audit + EPOCH render → Adreno GPU
```

Implementation status:
- `rust/arrow-bridge/` — real types + export registry. `arrow` feature gates FFI.
- `mobile/capacitor/android/app/src/main/cpp/arrow_jni.cpp` — JNI shim.
- `mobile/capacitor/src/services/DocumentParser.ts` — placeholder for LiteParse WASM.

True zero-copy requires SharedArrayBuffer (COOP/COEP headers) or direct WASM
linear memory. Real implementation is Phase 4.2 of the Ava Live checklist.

---

## 8. Mobile Runtime Stack — Native Only, No Root

### 8.1 Build path (Termux + Ubuntu proot)

See `scripts/bootstrap-termux.sh` for the real, verifiable setup script. Gemma
2B is installed inside the Ubuntu proot environment at `/usr/local/share/models/`
(or wherever the user placed it).

### 8.2 Native Activities (non-root path — THE ONLY PATH)

Android Native Activities give direct access to:
- **Adreno GPU via Vulkan** (compute shaders — no SDK, no Knox trip)
- **Adreno GPU via OpenCL** (via `libOpenCL.so`, available on most devices)
- **Hexagon NPU via NNAPI** (Android standard API 27+, falls back to GPU/CPU)
- **Bluetooth LE** (via `android.bluetooth.*`)
- **Audio** (via Oboe/AAudio)
- **Phone stack** (via `CallScreeningService`, `InCallService`, `PhoneStateListener` — see §10)

**No Knox trip. No vendor SDK. No root.** This is the only allowed path.

### 8.3 ~~KernelSU~~ (DROPPED)

**Section removed.** Per the architect's directive: Knox preservation is a
HARD constraint. Phone calls = income. Root paths (KernelSU, Magisk, custom
kernel modules) are explicitly forbidden because they trip Knox and break
phone calls. Do not propose root paths in future specs.

---

## 9. Network Sovereignty — WiFi Aware + Cloudflare WARP (No Root)

### 9.1 Protocol choice: WiFi Aware (NAN) primary, WiFi Direct fallback

Per the architect's directive: native APIs only, no root, preserve Knox.

| Protocol | Range | Bandwidth | Root needed? | Status |
|----------|-------|-----------|--------------|--------|
| **WiFi Aware (NAN)** | ~50m | Medium-High | ✅ No | ✅ PRIMARY — `WifiAwareManager` (API 26+) |
| **WiFi Direct** | ~100m | High | ✅ No | ✅ FALLBACK — `WifiP2pManager` (API 14+) |
| **BLE GATT** | ~10m | Low | ✅ No | Available for short-range |
| **Cellular (5G/4G)** | Carrier | High | ✅ No | Standard fallback |
| ~~802.11s mesh~~ | ~100m | High | ❌ Yes | ❌ DROPPED — root trips Knox |
| ~~RIL direct hooks~~ | varies | varies | ❌ Yes | ❌ DROPPED — root trips Knox |
| ~~LoRa~~ | ~10km | Very low | No (USB) | Available for long-range (USB dongle) |

**Why WiFi Aware over 802.11s:**
- 802.11s requires creating a mesh interface via `iw dev wlan0 interface add mesh0 type mp` — that's a root-only operation
- Root trips Knox → breaks phone calls → breaks income
- WiFi Aware (NAN) is a standard Android API since API 26 — no root, true peer-to-peer without WiFi infrastructure
- WiFi Aware supports data paths (NAN data paths) for actual data exchange between peers
- Lower power than WiFi Direct (designed for proximity-based discovery)

### 9.2 Cloudflare Mesh + WARP (cloud overlay)

Cloudflare Tunnel + WARP provide private mesh IP, client-to-client D2D, and
carrier-bypass tunneling. **Real, no root needed.**

- Cloudflare WARP uses Android's `VpnService` API (API 21+) — standard, no root, no Knox trip
- Configure via `wrangler.toml` + Cloudflare WARP Android client
- Routes traffic through Cloudflare's mesh, bypassing carrier restrictions
- WARP-to-WARP direct tunneling for peer-to-peer without exposing public IPs

### 9.3 Meshrabiya (sovereign mesh) implementation

Real implementation uses:
- `WifiAwareManager` for peer discovery (no root)
- NAN data paths for direct peer-to-peer data exchange (no root)
- Cloudflare WARP for cloud overlay (no root)
- BLE GATT for short-range fallback (no root)
- Cellular (5G/4G) as last resort (standard)

**No 802.11s. No RIL hooks. No custom kernel modules. No root.**

---

## 10. Phone Integration — Coexistence, Not Replacement (NEW)

**Critical constraint: Phone calls = income. AVA007 must coexist with the
phone stack, not compete with it.**

### 10.1 Standard Android telephony APIs (no root, no Knox trip)

| API | Use case | Android version | Root? |
|-----|----------|-----------------|-------|
| `CallScreeningService` | AVA007 screens incoming calls (accept/reject/silence) | 7.0+ (API 24) | ✅ No |
| `InCallService` | AVA007 can answer/reject calls programmatically | 6.0+ (API 23) | ✅ No |
| `PhoneStateListener` | AVA007 reacts to call state changes | 1.0+ (API 1) | ✅ No |
| `TelecomManager` | Place calls, end calls, query call state | 5.0+ (API 21) | ✅ No |
| `TelephonyManager` | Query carrier info, signal strength | 1.0+ (API 1) | ✅ No |

### 10.2 AVA007 phone integration patterns

1. **Call screening** — When an incoming call arrives, AVA007:
   - Pauses inference (preserve battery + RAM for the call)
   - Optionally screens the call (reject spam, route to voicemail)
   - Records the call event as an `insertIntelligence()` on the timeline

2. **In-call coexistence** — During an active call:
   - AVA007 inference is suspended (CPU/GPU given to the call stack)
   - Meta Harness still audits, but no new `insertIntelligence()` calls
   - Phone audio uses `AudioFocus` — AVA007 yields audio focus during calls

3. **Post-call resume** — When the call ends:
   - AVA007 resumes inference
   - Call metadata (caller, duration, outcome) is logged as a Research Atom
   - Optional: AVA007 generates a call summary via Gemma 2B

4. **Outbound call assistance** — AVA007 can:
   - Place calls on user's behalf via `TelecomManager.placeCall()`
   - Read back call notes during the call (via `TextToSpeech`)
   - Log call outcome as audit receipt

### 10.3 What AVA007 never does

- ❌ **Never blocks phone calls** — phone stack has priority
- ❌ **Never uses root for telephony** — would trip Knox
- ❌ **Never modifies carrier settings** — could break VoLTE
- ❌ **Never bypasses Do Not Disturb** — user controls, not AVA007

---

## 11. Data Ocean + Context Lake

| Layer | Technology | Status |
|-------|------------|--------|
| Ingestion | WebDAV → Cloudflare Pipelines | Stub (Phase 5) |
| Storage | Apache Iceberg on Cloudflare R2 | Stub |
| Analytical core | DuckDB with native Iceberg support | Stub (DuckDB Context Lake is L2 of TASHI) |
| Holographic reconstruction | `recallState(t)` uses Iceberg snapshots | Stub (Phase 6) |

---

## 12. FAPO (Pipeline-Aware Prompt Optimization) — UNVERIFIED

FAPO is referenced in a MarkTechPost article from June 2026 as a Cisco AI
research concept. The article is behind a Cloudflare challenge and I could not
directly verify it. Treat FAPO as **plausible but unverified**.

### 12.1 Where FAPO fits in AMOS

If verified, FAPO would be an **on-demand specialist** invoked by FABLE when:
- A multi-step pipeline fails at a specific step
- FABLE needs to optimize prompts for retry

FAPO is NOT in the hot path. It's a debugging/optimization tool for FABLE's
planning layer.

---

## 13. Vibe Thinker Integration

[VibeThinker-3B](https://huggingface.co/WeiboAI/VibeThinker-3B) is a real
3B-parameter model from WeiboAI, fine-tuned from Qwen2.5-Coder-3B for
verifiable reasoning (math, code, STEM).

### 13.1 Where Vibe Thinker fits in AMOS

**On-demand specialist**, not in the always-running path. Invoked by FABLE
only when:
- Task requires deep architectural reasoning
- Multi-agent planning needs verifiable math/code sub-tasks

### 13.2 Implementation status

Not implemented. Phase 8 of Ava Live checklist. When integrated, will run as a
separate `llama.cpp` Vulkan model instance, loaded on-demand to preserve RAM.

---

## 14. Latency Targets (grounded)

| Operation | Target | Notes |
|-----------|--------|-------|
| BLE scan → product ID | 30-50ms | Hardware interrupt |
| SemanticPacket serialization | < 1ms | JSON in native Kotlin |
| WebSocket send (local hotspot) | 2-5ms | S25 ↔ S26 on same hotspot |
| **Gemma 2B Q4 via llama.cpp Vulkan** | **50-150ms** | First-token latency |
| llama.cpp Vulkan (3B Q4) | 60-150ms | First-token latency |
| llama.cpp Vulkan (7B Q4) | 150-300ms | First-token latency |
| NNAPI NPU (3B Q4 on Hexagon) | 50-100ms | When available |
| `insertIntelligence()` + audit log | < 1ms | Tween append + TASHI receipt |
| UI projection (next frame) | ~16ms | Waits for GSAP ticker |
| **End-to-end (Gemma 2B)** | **~70-220ms** | Honest range |
| **End-to-end (7B model)** | **~200-400ms** | Honest range |

**"Sub-zero latency" is not a real concept.** Don't claim impossibilities.

---

## 15. Repository Structure

See `mobile-runtime` branch for current canonical layout. Key directories:
- `docs/` — architecture specs (this file, AVA_LIVE_CHECKLIST.md, etc.)
- `src/meta/`, `src/constellation/` (incl. `backends/`), `src/epoch/` — implemented pillars (TS)
- `src/constellation/backends/GemmaBackend.ts` — NEW primary backend (Gemma 2B via llama.cpp Vulkan)
- `src/subconscious/rev_ike/` — Subconscious (REV.IKE)
- `src/memory/tashi/` — TASHI memory
- `src/runtime/governance/` — governance
- `rust/meta-harness/`, `rust/constellation/`, `rust/arrow-bridge/`, `rust/gemma-bridge/` — Rust cores
- `mobile/capacitor/` — Capacitor Android app
- `mobile/capacitor/android/app/src/main/cpp/vulkan/` — Vulkan compute POC
- `mobile/capacitor/android/app/src/main/java/com/ava007/mobile/GemmaBridge.kt` — NEW Capacitor plugin for llama.cpp
- `scripts/bootstrap-termux.sh` — real Termux setup script
- `archive/` — legacy subsystems

---

## 16. Build & Deployment Strategy

### 16.1 Development environment

- **Termux + Ubuntu proot-distro** on S25/S26 Ultra (Gemma 2B installed inside proot)
- **Rust toolchain** with `aarch64-linux-android` target
- **Android NDK 26.x** + Android SDK 34
- **Capacitor CLI** 5.x
- **cargo-ndk** for Rust → Android cross-compilation
- **llama.cpp** built with `-DGGML_VULKAN=ON` for primary inference path

### 16.2 Build pipeline

```bash
# 1. Build Rust NDK libraries (Meta Harness, Constellation, Arrow, Gemma bridge)
cd rust && cargo ndk --target aarch64-linux-android --platform 21 build --release
cp target/aarch64-linux-android/release/*.so ../mobile/capacitor/android/app/src/main/jniLibs/arm64-v8a/

# 2. Build llama.cpp with Vulkan backend
cd /path/to/llama.cpp
mkdir build && cd build
cmake .. -DGGML_VULKAN=ON -DCMAKE_TOOLCHAIN_FILE=$NDK_HOME/build/cmake/android.toolchain.cmake \
  -DANDROID_ABI=arm64-v8a -DANDROID_PLATFORM=android-24
make -j llama
cp libllama.so libggml*.so $REPO/mobile/capacitor/android/app/src/main/jniLibs/arm64-v8a/

# 3. Build Capacitor web assets
cd $REPO/mobile/capacitor && npm ci && npm run build
npx cap sync android

# 4. Build APK
cd android && ./gradlew assembleDebug

# 5. Install on device (preserve Knox — standard install only, no root)
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

### 16.3 ~~Root path~~ — REMOVED

No root path. Knox preservation is a hard constraint. Phone calls = income.

---

## 17. Security & Governance

- **Meta Harness** enforces isolation (ArrowJS sandboxes), validation, audit trails on every layer
- **TASHI** provides immutable audit receipts (SHA-256 hash, signed) for every `insertIntelligence()` call
- **No committed secrets** — `.env`, `*.private.pem`, `*.private.key` are gitignored
- **DID-based identity** — no raw PII in payloads
- **Redaction policies** in Meta Harness scrub sensitive fields before cloud calls
- **No vendor SDK** — Vulkan + NNAPI + CPU only. No QNN. No SNPE.
- **No root** — Knox preserved. Phone calls keep working.
- **Phone stack priority** — AVA007 yields CPU/GPU/audio during active calls

---

## 18. What's been stripped from earlier specs (v2.4 through v2.7)

| Stripped component | Reason |
|--------------------|--------|
| **GLM-5.2** | Doesn't exist as a published model. |
| **IndexShare / FlashAssign** | Not real Z.ai terminology. Fabricated. |
| **Mercury-2 model** | Not a real published model. |
| **"Quantum MemBrain superposition collapse"** | Marketing metaphor. Real: tween interpolation + event sourcing. |
| **"Sub-zero latency"** | Physically impossible. Real: 70-220ms end-to-end. |
| **"Pre-computed state space"** | Misleading. You can't pre-compute every possible LLM response. |
| **"KernelSU preserves Samsung Pay where possible"** | False. Knox e-fuse is one-way trip. |
| **"217GB model on 24GB RAM"** | Physically impossible. |
| **"webllm+ T-MAN NPU acceleration"** | Conflation. WebLLM uses WebGPU. T-MAN is internal Qualcomm. |
| **QNN SDK as primary path** | ❌ Replaced by Gemma 2B via llama.cpp Vulkan |
| **SNPE** | ❌ Proprietary, dropped |
| **802.11s mesh** (v2.7 locked it in) | ❌ Replaced by WiFi Aware (NAN) — 802.11s requires root, root trips Knox |
| **KernelSU root path** (v2.7 had it as "optional") | ❌ DROPPED — Knox preservation is hard constraint; phone calls = income |
| **RIL direct hooks** | ❌ Requires root, trips Knox |
| **Custom kernel modules** | ❌ Trips Knox |
| **Magisk module `/system/lib64/` for app-loaded .so** | Redundant — apps load .so from APK jniLibs. |
| **`subprocess.run(['llamdrop', packet])` Python** | Type error + llamdrop binary doesn't exist. |
| **`window.mlc.createMLCEngine()`** | Wrong API. Real: `import { CreateMLCEngine } from '@mlc-ai/web-llm'`. |
| **Constellation router calling metaHarness.intercept()** | Circular dependency. |
| **REV.IKE as "sub-20ms reflex layer"** (v2.6 mischaracterization) | Corrected: REV.IKE = Subconscious (read-only interpreter). |
| **GSAP timeline as cognitive driver** (v2.6 mischaracterization) | Corrected: timeline is audit; `insertIntelligence()` is the operation. |
| **"Download Llama-3.2-3B" as primary** (v2.7 framing) | Corrected: Gemma 2B is already on device — use it as primary |

---

## 19. Implementation Status Summary

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
| **GemmaBackend.ts** (NEW — Gemma 2B via llama.cpp Vulkan) | DONE | `mobile-runtime` | 4.1 |
| **rust/gemma-bridge/** (NEW — Rust FFI to llama.cpp) | DONE | `mobile-runtime` | 4.1 |
| **GemmaBridge.kt** (NEW — Capacitor plugin for llama.cpp) | DONE | `mobile-runtime` | 4.1 |
| AMOS v2.8 spec (this document) | DONE | `mobile-runtime` | 0 |
| Vulkan compute POC | DONE | `mobile-runtime` | 0 |
| Pre-flight on dev machine | PENDING | — | 1 |
| Device setup (Gemma 2B already installed) | PARTIAL | — | 2 |
| First live boot | PENDING | — | 3 |
| **llama.cpp Vulkan integration real** (Gemma 2B primary) | PENDING | — | 4.1 |
| Arrow zero-copy real | PENDING | — | 4.2 |
| NNAPI delegate integration | PENDING | — | 4.3 |
| **Phone integration** (CallScreeningService etc.) | PENDING | — | 4.5 (NEW) |
| TASHI L1-L4 memory | PENDING | — | 5 |
| GSAP temporal engine | PENDING | — | 6 |
| EPOCH presentation real | PENDING | — | 7 |
| AVA007 executive loop | PENDING | — | 8 |
| **Meshrabiya mesh (WiFi Aware + WARP)** | PENDING | — | 9 |
| Production hardening | ONGOING | — | 10 |

---

## 20. Critical Path to First Live Demo

Phases 0 → 1 → 2 → 3 → 4.1 (Gemma 2B via llama.cpp Vulkan — model already on device) → 8.1 (basic orchestrator)

**~1-2 weeks** of focused work for a first live demo on S25 Ultra (faster than
v2.7's estimate because Gemma 2B is already installed — no download step).

Full AMOS v2.8 production: ~3 months.

---

*This document is the canonical AMOS v2.8 specification. It supersedes v2.1
through v2.7. All future work must reference this document.*

*Last updated: 2026-06-23 by Super Z (per architect's directive: Gemma 2B primary, native mesh, phone coexistence, Knox preserved)*
