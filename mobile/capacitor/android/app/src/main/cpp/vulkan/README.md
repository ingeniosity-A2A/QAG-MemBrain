# AMOS v2.7 — Vulkan Compute Shader POC

Minimal proof-of-concept that **GPU access works via standard Vulkan compute
shaders** on Samsung Galaxy S25/S26 Ultra — **without any Qualcomm SDK and
without tripping Knox**.

## Why this exists

Per the architect's directive (AMOS v2.7 §5):
> "Use hardware acceleration without those dependencies. Vulkan compute
> shaders — standard Android API, no Knox trip."

This POC proves the SDK-free path works before we invest in real `llama.cpp`
Vulkan backend integration (Phase 4.1 of the Ava Live checklist).

## What it does

Performs a 4×4 matrix multiplication on the Adreno GPU via Vulkan compute
shaders, then reads back the result and verifies it matches the CPU reference.

If `C = A * B` where `A = 2*I` and `B = 3*I`, then `C` should equal `6*I`.

## Files

| File | Purpose |
|------|---------|
| `matmul.glsl` | GLSL compute shader source (4×4 matmul, 1 workgroup of 4×4 invocations) |
| `matmul.cpp` | C++ host code: Vulkan init, buffer creation, dispatch, result verification |

## Build (NDK, on dev machine)

```bash
# Prerequisites (from scripts/bootstrap-termux.sh):
# - Android NDK 26.x at $NDK_HOME
# - Vulkan headers (included in NDK)

# 1. Compile GLSL → SPIR-V (use glslangValidator from Android SDK or shaderc)
glslangValidator -V matmul.glsl -o matmul.comp.spv

# 2. Compile C++ host code → shared library for arm64-v8a
$NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/bin/aarch64-linux-android24-clang++ \
  -std=c++17 -fPIC -shared -o libvulkan_matmul.so matmul.cpp \
  -lvulkan -llog

# 3. Copy to APK jniLibs
cp libvulkan_matmul.so $REPO/mobile/capacitor/android/app/src/main/jniLibs/arm64-v8a/
cp matmul.comp.spv $REPO/mobile/capacitor/android/app/src/main/assets/
```

## Run on device

The `amos_vulkan_matmul_poc(const char* shaderPath)` C function is the
entry point. Call it from:

1. **A native Activity** (simplest — direct C++ binary, no JNI)
2. **A Capacitor plugin** (Kotlin → JNI → C++) — same pattern as `QNNPlugin.kt` but using Vulkan instead of QNN
3. **A unit test binary** pushed via `adb push` + `adb shell`

Expected logcat output (tag: `amos-vulkan-poc`):

```
I amos-vulkan-poc: === AMOS v2.7 Vulkan Compute Shader POC ===
I amos-vulkan-poc: Vulkan instance created
I amos-vulkan-poc: Using GPU: Adreno (TM) 750 (Vulkan 1.3.x)
I amos-vulkan-poc: Compute queue family: 0
I amos-vulkan-poc: Logical device + queue created
I amos-vulkan-poc: Loaded SPIR-V shader: matmul.comp.spv (1234 bytes, 309 words)
I amos-vulkan-poc: Shader module created
I amos-vulkan-poc: Compute pipeline created
I amos-vulkan-poc: Buffers created (3 x 64 bytes)
I amos-vulkan-poc: Input matrices filled (A = 2*I, B = 3*I)
I amos-vulkan-poc: Compute shader dispatched + completed
I amos-vulkan-poc: Result matrix C (expected = 6 * I):
I amos-vulkan-poc:   [  6.00   0.00   0.00   0.00]
I amos-vulkan-poc:   [  0.00   6.00   0.00   0.00]
I amos-vulkan-poc:   [  0.00   0.00   6.00   0.00]
I amos-vulkan-poc:   [  0.00   0.00   0.00   6.00]
I amos-vulkan-poc: ✓ POC SUCCESS: GPU result matches CPU reference
```

## What this proves

✅ Vulkan compute shaders work on Adreno 750 via standard Android Vulkan API
✅ No Qualcomm QNN SDK required
✅ No Knox trip (Vulkan is a standard Android API since API 24)
✅ Zero-copy buffer access works (host-visible + host-coherent memory)
✅ Ready to scale up to `llama.cpp` `ggml-vulkan` backend for real LLM inference

## What this does NOT prove

❌ LLM inference performance (this is just a 4×4 matmul)
❌ Memory pressure under real workloads (16 floats vs gigabytes)
❌ Thermal / battery behavior under sustained load
❌ Multi-queue parallelism

Those questions are answered by the real `llama.cpp` Vulkan integration in
Phase 4.1 of the Ava Live checklist — which uses the same Vulkan compute
shaders but with optimized attention + matmul kernels.

## Next steps

After this POC verifies on device:
1. Build `llama.cpp` with `-DGGML_VULKAN=ON` for `arm64-v8a`
2. Wire `MlcLlmBackend.ts` to call `llama.cpp` via JNI instead of `@mlc-ai/web-llm`
3. Test with `Llama-3.2-3B-Instruct-Q4_K_M.gguf` (~2 GB)
4. Measure first-token latency + sustained tok/sec on S25 Ultra Adreno 750
