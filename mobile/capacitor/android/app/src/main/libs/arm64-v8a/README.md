# Native libraries (arm64-v8a)

This directory holds the .so files produced by building `rust/` with cargo-ndk.

**Expected outputs after build:**
- `libqnn_jni.so`     — QNN JNI shim (built from `rust/qnn-bridge/`)
- `libarrow_jni.so`   — Arrow JNI shim (built from `rust/arrow-bridge/`)
- `libQnnNetRun.so`   — Qualcomm QNN SDK runtime (copied from `${QNN_SDK_DIR}/lib/aarch64-android/`)

Files are NOT committed — they are build artifacts. The directory is created
here as a placeholder so the build system knows where to drop them.
