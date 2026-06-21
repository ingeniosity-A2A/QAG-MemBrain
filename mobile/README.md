# Mobile Runtime — AMOS v2.1

The Mobile Runtime pillar provides the device-native execution layer for the
AVA007 Sovereign Agentic Mobile Operating System on Samsung Galaxy S25/S26
Ultra (Snapdragon 8 Elite).

## Status

**GREENFIELD** — Phase 1 audit confirmed that no `mobile/` directory exists on
`main` or `fix/build-stabilization`. This branch (`mobile-runtime`) is where
the Mobile Runtime pillar is being built from scratch.

## Structure

```
mobile/
├── capacitor/                 # Capacitor Android app (web shell + native bridge)
│   ├── package.json
│   ├── capacitor.config.ts
│   ├── index.html
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── AvaContext.tsx
│   │   ├── InputOrchestrativeInterface.tsx
│   │   ├── components/
│   │   │   ├── AnimatedUI.tsx
│   │   │   ├── AgentSandbox.tsx
│   │   │   └── FurnitureViewer.tsx
│   │   ├── services/
│   │   │   ├── WebLLMEngine.ts
│   │   │   ├── NPUBridge.ts
│   │   │   └── DocumentParser.ts
│   │   └── styles/
│   │       └── global.css
│   └── android/                # Capacitor-generated + native code
│       └── app/src/main/
│           ├── java/com/ava007/mobile/
│           │   ├── QNNPlugin.kt
│           │   └── ArrowBridge.kt
│           ├── cpp/             # Native code (QNN + Arrow)
│           │   ├── qnn_jni.cpp
│           │   ├── qnn_wrapper.cpp
│           │   ├── arrow_jni.cpp
│           │   ├── arrow_wrapper.cpp
│           │   └── CMakeLists.txt
│           └── libs/arm64-v8a/  # Native libraries (.so files)
│               ├── libqnn_jni.so     (placeholder — built from rust/)
│               ├── libarrow_jni.so   (placeholder — built from rust/)
│               └── libQnnNetRun.so   (Qualcomm SDK)
├── gsap-config.ts              # GSAP animation configuration
├── performance.ts              # Performance budgets and metrics
├── MANIFEST.md                 # Full file manifest with AMOS v2.1 pillar mapping
└── PLACEHOLDER.manifest.json   # Machine-readable manifest
```

## Build Path

1. Bootstrap Termux + Ubuntu proot-distro on target device (S25/S26 Ultra).
2. Install Rust toolchain + Android NDK + Capacitor CLI.
3. Build `rust/` crates → produce `mobile/capacitor/android/app/src/main/libs/arm64-v8a/*.so`
4. Run `npx cap sync android` to package the web shell.
5. Deploy APK to device (root path with Magisk for full sovereignty).

## Dependencies

Per AMOS v2.1:
- Capacitor ^5.7.0
- @capacitor/android ^5.7.0
- @mlc-ai/web-llm ^0.2.0
- @arrow-js/sandbox ^0.1.0
- gsap ^3.12.5
- react ^18.2.0
- react-dom ^18.2.0
- three ^0.164.0
- Qualcomm QNN SDK (Hexagon NPU)
- Apache Arrow C Data Interface

## References

- `docs/AMOS_v2.1_ARCHITECTURE.md` — full architectural blueprint
- `mobile/MANIFEST.md` — file manifest with pillar mapping
- `mobile/PLACEHOLDER.manifest.json` — machine-readable manifest
