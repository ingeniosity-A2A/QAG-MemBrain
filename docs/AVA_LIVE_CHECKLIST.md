# Bringing Ava Live — Deployment Checklist

**Owner:** Zai
**Target:** Samsung Galaxy S25 Ultra / S26 Ultra (Snapdragon 8 Elite)
**Source branch:** `mobile-runtime`
**Final branch:** `main` (after merge)

This is the authoritative checklist for bringing AVA007 AMOS v2.1 from the
current state (scaffolded + wired, builds clean) to a live sovereign agent
running on a physical device.

---

## Phase 0 — Repository State (DONE)

- [x] `main` merged with `fix/build-stabilization` (merge commit `b7308cd951`)
- [x] `opencode/brave-pixel` fast-forwarded to merge commit
- [x] `runtime-consolidation` branch created with Phase 2 manifest applied
- [x] `mobile-runtime` branch created with AMOS v2.1 spec + scaffolding
- [x] AMOS v2.1 pillars implemented (`src/meta/`, `src/constellation/`, `src/epoch/`, `rust/`)
- [x] Rust crates compile, 11 unit tests pass (`cd rust && cargo test`)
- [x] TypeScript type-checks clean for new code (`npx tsc --noEmit`)
- [x] Mobile capacitor shell type-checks clean (own tsconfig)
- [x] App.tsx wired to initialize Meta Harness + Constellation on mount
- [x] InputOrchestrativeInterface.tsx routes user input through `metaHarness.intercept()`
- [x] WebLLMEngine.ts routes inference through `constellation.route()` before any backend call

---

## Phase 1 — Pre-Flight on Dev Machine (1-2 days)

Goal: confirm the repo builds end-to-end on a real dev machine before
touching a phone.

### 1.1 Toolchain install

- [ ] Install Node 20+ and npm
- [ ] Install Rust toolchain: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- [ ] Install Android Studio (for SDK + NDK + platform-tools)
- [ ] Set `ANDROID_HOME` and `ANDROID_NDK_HOME` env vars
- [ ] Install `cargo-ndk`: `cargo install cargo-ndk`
- [ ] Add Android targets to Rust: `rustup target add aarch64-linux-android armv7-linux-androideabi`
- [ ] Install Capacitor CLI globally: `npm install -g @capacitor/cli`
- [ ] Install Termux + Ubuntu proot on dev machine (for ARM cross-compile testing)

### 1.2 Build verification

- [ ] Clone: `git clone -b mobile-runtime git@github.com:ingeniosity-A2A/QAG-MemBrain-.git`
- [ ] Root install: `npm ci`
- [ ] Root type-check: `npx tsc --noEmit` (135 pre-existing errors are OK; new code is 0)
- [ ] Root test: `npm test` (existing vitest suite)
- [ ] Rust test: `cd rust && cargo test` (must show 11 passed)
- [ ] Rust Android build: `cd rust && cargo ndk -t arm64-v8a build --release`
- [ ] Mobile install: `cd mobile/capacitor && npm ci`
- [ ] Mobile type-check: `npx tsc --noEmit -p mobile/capacitor/tsconfig.json` (0 errors)
- [ ] Mobile web build: `cd mobile/capacitor && npm run build`

### 1.3 Capacitor Android project bootstrap

- [ ] `cd mobile/capacitor && npx cap add android`
- [ ] Verify `mobile/capacitor/android/` directory created
- [ ] Copy `QNNPlugin.kt` and `ArrowBridge.kt` from `mobile/capacitor/android/app/src/main/java/com/ava007/mobile/` into the generated android project (Capacitor will have created the same path)
- [ ] Copy `cpp/` directory and `CMakeLists.txt` into the generated android project
- [ ] Add QNN SDK path to `local.properties`: `qnn.sdk.dir=/path/to/qnn-sdk`
- [ ] Verify Gradle sync: `cd mobile/capacitor/android && ./gradlew tasks`
- [ ] Build APK (debug): `./gradlew assembleDebug`

### 1.4 Sign-off

- [ ] APK builds without errors
- [ ] APK installs on emulator (API 34+) and launches without crash
- [ ] Web shell renders the `Initializing AMOS v2.1...` screen
- [ ] Console shows `[audit] pre ava007/delegate` on every input
- [ ] Console shows `[ingress]` log on every input

---

## Phase 2 — Device Setup (0.5 day)

Goal: prepare the S25 Ultra for development deployment.

### 2.1 Device unlock + Termux

- [ ] Enable Developer Options on S25 Ultra (Settings → About → tap Build Number 7x)
- [ ] Enable USB Debugging
- [ ] Install Termux from F-Droid (NOT Play Store — Play Store version is deprecated)
- [ ] In Termux: `pkg update && pkg upgrade`
- [ ] In Termux: `pkg install proot-distro`
- [ ] Install Ubuntu proot: `proot-distro install ubuntu`
- [ ] Login to Ubuntu: `proot-distro login ubuntu`
- [ ] Inside Ubuntu: `apt update && apt install -y curl build-essential`

### 2.2 Optional: Magisk root (for Meshrabiya network unlock)

**Only if you want full Meshrabiya sovereignty features. Skip for first live boot.**

- [ ] Unlock bootloader (WARNING: wipes device, may void warranty depending on region)
- [ ] Flash Magisk-patched boot image
- [ ] Verify root: `adb shell su -c id`
- [ ] Install Magisk modules for network sovereignty (Meshrabiya)

### 2.3 ADB connection

- [ ] Connect S25 Ultra to dev machine via USB
- [ ] `adb devices` shows the device
- [ ] `adb shell getprop ro.product.model` returns `SM-S931B` (S25 Ultra) or similar
- [ ] `adb shell getprop ro.board.platform` returns the Snapdragon 8 Elite SoC

---

## Phase 3 — First Live Boot (1 day)

Goal: get AMOS running on the device, even if backends are stubs.

### 3.1 Deploy APK to device

- [ ] `cd mobile/capacitor && npx cap run android` (or `adb install android/app/build/outputs/apk/debug/app-debug.apk`)
- [ ] App launches on device
- [ ] No native crash logs: `adb logcat | grep -i ava007`
- [ ] No JS errors: `adb logcat -s Chromium`

### 3.2 Verify Meta Harness is active

- [ ] Open the app on device
- [ ] Wait for "Initializing AMOS v2.1..." screen to clear
- [ ] Verify "Meta Harness: ACTIVE" appears in the UI
- [ ] Type "hello" in the input box, press Send
- [ ] Verify `[audit] pre ava007/delegate` log line appears
- [ ] Verify `[ingress] { userInput: 'hello' }` log line appears
- [ ] Verify result card appears showing "Allowed: yes" with duration in ms
- [ ] Try spamming Send 100+ times in 60s — verify rate-limit policy kicks in and shows "Policy denied: rate_limit 'default-rate-limit' exceeded"

### 3.3 Verify Constellation routing

- [ ] Trigger an inference call (e.g. wire a "Generate" button that calls `webllmEngine.generate("hello")`)
- [ ] Verify `constellation.route()` returns a routing decision
- [ ] Verify the routing decision appears in the result (backend, modelId, latency estimate)
- [ ] With `requireLocal: true` set in WebLLMConfig, verify Constellation never picks `cloud` backend

### 3.4 Sign-off

- [ ] App boots in < 3 seconds on device
- [ ] User input → Meta Harness → result loop completes in < 100ms (excluding inference)
- [ ] No memory leaks over 100 input cycles (monitor via `adb shell dumpsys meminfo com.ava007.mobile`)

---

## Phase 4 — Real Backends (1-2 weeks)

Goal: replace the stub backend dispatchers in `WebLLMEngine.ts` with real
implementations. Order matters — easiest first.

### 4.1 WebGPU backend (easiest — pure JS)

- [ ] Add `@mlc-ai/web-llm` to mobile/capacitor/package.json (already declared, just needs `npm ci`)
- [ ] Implement `callWebGpu(modelId, prompt)` in WebLLMEngine.ts using `@mlc-ai/web-llm`'s `CreateMLCEngine(modelId, { device: 'webgpu' })`
- [ ] Download model files for `gemma-2-9b-it-q4f16_1` (will be cached in IndexedDB)
- [ ] Verify inference runs on device
- [ ] Measure latency: target < 1000ms per token on S25 Ultra Adreno 750

### 4.2 CPU backend (fallback)

- [ ] Implement `callCpu(modelId, prompt)` using `@mlc-ai/web-llm` with CPU device
- [ ] Verify it works on devices without WebGPU
- [ ] Measure latency: expect 5-10x slower than WebGPU

### 4.3 QNN NPU backend (requires native code)

- [ ] Get Qualcomm QNN SDK access (apply at https://developer.qualcomm.com/software/qualcomm-neural-ai-engine)
- [ ] Download QNN SDK for Linux (the host build environment)
- [ ] Set `QNN_SDK_DIR` env var
- [ ] Create `rust/qnn-bridge/qnn-sys/` crate with FFI bindings to QNN SDK headers
- [ ] Enable `qnn_sdk` feature in `rust/qnn-bridge/Cargo.toml`
- [ ] Implement real `QnnBridge::init()`, `load_model()`, `infer()` in `rust/qnn-bridge/src/lib.rs`
- [ ] Cross-compile: `cargo ndk -t arm64-v8a build --release --features qnn_sdk`
- [ ] Copy `libqnn_jni.so` to `mobile/capacitor/android/app/src/main/libs/arm64-v8a/`
- [ ] Convert Gemma 2 9B model to QNN format using QNN SDK tools
- [ ] Push model to device: `adb push models/qnn/gemma_qnn.bin /data/local/tmp/`
- [ ] Implement `callQnnNpu(modelId, prompt)` in WebLLMEngine.ts to call `NPUBridge.ts` → `QNNPlugin.kt` → `libqnn_jni.so`
- [ ] Verify inference runs on Hexagon NPU
- [ ] Measure latency: target < 80ms first-token on S25 Ultra Hexagon NPU

### 4.4 llamdrop backend (T-MAN 1.58-bit)

- [ ] Get llamdrop runtime (internal to ingeniosity-A2A — request access)
- [ ] Implement `callLlamdrop(modelId, prompt)` calling the llamdrop local runtime
- [ ] Verify 1.58-bit T-MAN inference runs
- [ ] Measure latency + battery: expect lowest power of all local backends

### 4.5 Cloud backend (only if requireLocal=false)

- [ ] Pick a cloud provider (GLM-5, Qwen, DeepSeek, etc.)
- [ ] Implement `callCloud(modelId, prompt)` via fetch() to cloud endpoint
- [ ] Wire API key via Capacitor SecureStorage (NEVER commit the key)
- [ ] Add redaction policy in Meta Harness to scrub PII before cloud calls
- [ ] Verify routing only picks cloud when `requireLocal === false`

### 4.6 Sign-off

- [ ] All 5 backends functional in isolation
- [ ] Constellation routes correctly based on budget / requireLocal / health
- [ ] Health checks correctly mark unhealthy backends (kill the backend process, verify Constellation stops routing to it)

---

## Phase 5 — TASHI Memory Integration (1 week)

Goal: wire Meta Harness audit events to TASHI L1 JSONL store.

### 5.1 TASHI L1 JSONL writer

- [ ] Implement `AuditLogger.setSink()` callback in `mobile/capacitor/src/services/TashiSink.ts`
- [ ] Sink writes audit events to `app://local/tashi/l1/audit.jsonl` via Capacitor Filesystem API
- [ ] Verify events persist across app restarts
- [ ] Implement rotation: when `audit.jsonl` exceeds 10MB, rotate to `audit.YYYYMMDDHHmmss.jsonl`

### 5.2 TASHI L2 DuckDB Context Ocean

- [ ] Install DuckDB-WASM: `npm install @duckdb/duckdb-wasm`
- [ ] Implement `DuckDBProvider.ts` (was placeholder — make real)
- [ ] Periodically (every 5 min) bulk-import L1 JSONL into DuckDB
- [ ] Implement `ContextLake.ts` query API (recall by traceId, by pillar, by time range)
- [ ] Verify queries return expected events

### 5.3 TASHI receipts

- [ ] Each audit event should now produce a real TASHI receipt (not just in-memory)
- [ ] Receipts include SHA-256 hash of canonical event JSON (use Web Crypto API)
- [ ] Receipts stored in DuckDB governance table
- [ ] Verify receipts can be retrieved by `traceId` for replay

### 5.4 Sign-off

- [ ] Audit log persists across app restarts
- [ ] DuckDB query "show me all ava007/delegate events from yesterday" returns correct results
- [ ] Receipts match between L1 JSONL and L2 DuckDB

---

## Phase 6 — GSAP Temporal Engine (1 week)

Goal: timeline reconstruction works.

### 6.1 FrameScheduler integration

- [ ] Wire `FrameScheduler` from `src/epoch/FrameScheduler.ts` into App.tsx
- [ ] Subscribe AnimatedUI to FrameScheduler (replace any internal rAF calls)
- [ ] Verify single rAF loop drives all animations

### 6.2 GSAP timeline

- [ ] Implement at least one real animation: e.g. status indicator pulses when Meta Harness intercepts
- [ ] Verify 60fps on device (no jank)

### 6.3 Replay

- [ ] Implement `ReplayEngine.ts` that takes a `traceId` and reconstructs the timeline from TASHI L1/L2
- [ ] Add UI button "Replay last session" that calls ReplayEngine
- [ ] Verify replay renders the original session's animations

### 6.4 Sign-off

- [ ] Replay reconstructs a 60-second session in < 2 seconds
- [ ] No frame drops during replay

---

## Phase 7 — EPOCH Adaptive Presentation (1 week)

Goal: EPOCH components actually render agent output.

### 7.1 AgentSandbox

- [ ] Implement `AgentSandbox.render()` to take LLM-generated HTML and render it safely
- [ ] Verify sandbox blocks `<script>` tags, `javascript:` URLs, etc.
- [ ] Test with malicious payloads from OWASP XSS cheat sheet

### 7.2 FurnitureViewer

- [ ] Get a real glTF/GLB model (e.g. a 3D furniture model from a free asset library)
- [ ] Implement `FurnitureViewer.addModel()` using GLTFLoader from `three/examples/jsm/loaders/GLTFLoader.js`
- [ ] Verify model renders at 60fps on device

### 7.3 AdaptiveLayout

- [ ] Wire `AdaptiveLayout.decide()` to device state from Capacitor APIs:
  - Orientation: `@capacitor/screen-reader` or `window.screen.orientation`
  - Battery: `@capacitor/device` `Device.getBatteryInfo()`
  - Thermal: `@capacitor-community/thermal-monitor` (or native plugin)
- [ ] Verify layout changes when device rotates
- [ ] Verify animations reduce when thermal state rises
- [ ] Verify render quality drops when battery < 15%

### 7.4 Sign-off

- [ ] EPOCH renders agent output safely
- [ ] 3D viewer works at 60fps
- [ ] Layout adapts to orientation + thermal + battery

---

## Phase 8 — AVA007 Executive Loop (2 weeks)

Goal: replace the stub `execute` callback in `InputOrchestrativeInterface.tsx`
with the real AVA007 executive loop.

### 8.1 AVA007 orchestrator

- [ ] Implement `src/ava007/orchestrator.ts` with the real task-routing algorithm
- [ ] AVA007 should call other pillars via `metaHarness.intercept()`:
  - Reflex tasks → `metaHarness.intercept({ pillar: 'rev_ike', operation: 'reflex', ... })`
  - Planning tasks → `metaHarness.intercept({ pillar: 'fable', operation: 'plan', ... })`
  - Tool calls → `metaHarness.intercept({ pillar: 'goose', operation: 'execute', ... })`
  - Recall → `metaHarness.intercept({ pillar: 'tashi', operation: 'recall', ... })`
  - Inference → goes through WebLLMEngine → Constellation
- [ ] Verify AVA007 never bypasses Meta Harness

### 8.2 Confidence-based arbitration

- [ ] When REV.IKE reflex and FABLE planning disagree, route through Arbitrator
- [ ] If Arbitrator outcome is `escalate`, AVA007 makes the final call
- [ ] Verify escalation path works end-to-end

### 8.3 Sign-off

- [ ] Multi-step task: "What's the weather? Then plan a picnic." — AVA007 should:
  1. Reflex: identify as 2-task request
  2. Call GOOSE to fetch weather
  3. Call FABLE to plan picnic
  4. Synthesize final response
- [ ] All steps audited through Meta Harness
- [ ] Full trace replayable via GSAP

---

## Phase 9 — Meshrabiya Sovereign Mesh (optional, requires root)

Goal: full network sovereignty via Meshrabiya.

### 9.1 Meshrabiya routing

- [ ] Implement `src/telecom/meshrabiya/` (currently stub)
- [ ] WiFi Direct service discovery
- [ ] LoRa bridge integration (via `src/telecom/nodes/lora_bridge.ts`)
- [ ] Virtual IP assignment
- [ ] RIL hooks for data service unlock (requires root)

### 9.2 Sign-off

- [ ] Two S25 Ultras can discover each other via WiFi Direct
- [ ] Messages route via Meshrabiya without internet
- [ ] LoRa bridge works for long-range fallback

---

## Phase 10 — Production Hardening (ongoing)

### 10.1 Security

- [ ] Rotate the committed `.env` and `authoritySigner.private.pem` (these were deleted from `runtime-consolidation` but may still be in git history — rotate anyway)
- [ ] Add CSRF protection to any HTTP endpoints
- [ ] Add certificate pinning to cloud backend calls
- [ ] Pen-test the AgentSandbox (try to escape the ArrowJS sandbox)

### 10.2 Performance

- [ ] Profile hot path with Chrome DevTools (device)
- [ ] Optimize FrameScheduler to skip frames when over budget
- [ ] Implement model warm-up: preload default model on app start
- [ ] Implement request coalescing for burst inputs

### 10.3 Observability

- [ ] Ship crash logs to a collection endpoint (or local-only via TASHI)
- [ ] Implement performance tracing (Chrome Performance panel + Trace Event Format)
- [ ] Add a hidden diagnostic screen (long-tap version number 5x) showing:
  - Active backends + health
  - Recent audit events
  - Memory usage
  - Thermal state

### 10.4 Distribution

- [ ] Sign APK with release keystore
- [ ] Set up automated builds via GitHub Actions (`.github/workflows/android.yml`)
- [ ] Set up Play Store listing (or sideload-only distribution)
- [ ] Document sideload install for end users

---

## Oversight Summary

| Phase | Status | ETA | Blocker |
|-------|--------|-----|---------|
| 0 — Repository state | ✅ DONE | — | — |
| 1 — Pre-flight on dev machine | ⏳ PENDING | 1-2 days | Need real dev machine (this audit was on a sandboxed env) |
| 2 — Device setup | ⏳ PENDING | 0.5 day | Need physical S25 Ultra |
| 3 — First live boot | ⏳ PENDING | 1 day | Phases 1+2 |
| 4 — Real backends | ⏳ PENDING | 1-2 weeks | QNN SDK access approval |
| 5 — TASHI memory | ⏳ PENDING | 1 week | Phase 3 |
| 6 — GSAP temporal | ⏳ PENDING | 1 week | Phase 5 |
| 7 — EPOCH presentation | ⏳ PENDING | 1 week | Phase 6 |
| 8 — AVA007 executive loop | ⏳ PENDING | 2 weeks | Phases 4+5+6+7 |
| 9 — Meshrabiya (optional) | ⏳ PENDING | 2 weeks | Requires rooted device |
| 10 — Production hardening | ⏳ ONGOING | continuous | All phases |

**Critical path to "Ava Live" (minimum viable):**
Phases 0 → 1 → 2 → 3 → 4.1 (WebGPU only) → 8.1 (basic orchestrator)
= **~2-3 weeks** of focused work for a first live demo.

**Full AMOS v2.1 (all pillars production-ready):**
Phases 0 through 10 = **~3 months** of focused work.

---

## Daily Standup Template

```
Yesterday:
  - Phase X.Y: <what you did>
Today:
  - Phase X.Y: <what you'll do>
Blockers:
  - <blocker> — need <action>
Ava status:
  - Live: <yes/no>
  - Hot path latency: <ms>
  - Last successful end-to-end session: <timestamp>
```

---

## Emergency Rollback

If a deploy goes bad:

```bash
# Roll back to before merge commit
git push -f origin fae3c18976:refs/heads/main
git push -f origin e29ff90fa6:refs/heads/opencode/brave-pixel

# Delete new branches
git push origin --delete mobile-runtime
git push origin --delete runtime-consolidation
```

This restores the repo to its state before any of my work. The AMOS v2.1
spec is preserved in the deleted branches' history (recoverable via
`git reflog` for 90 days).

---

*Last updated: 2026-06-22 by Super Z*
*Next review: after Phase 1 sign-off*
