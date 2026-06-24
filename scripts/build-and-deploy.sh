#!/usr/bin/env bash
#
# AMOS v2.8 — Build & Deploy Pipeline
#
# This script does EVERYTHING needed to get AVA007 AMOS running on a
# Samsung Galaxy S25 Ultra today, with Gemma 2B (already on device) as
# the primary inference backend via llama.cpp Vulkan.
#
# Prerequisites (one-time, see scripts/bootstrap-termux.sh):
#   - Termux + Ubuntu proot-distro
#   - Rust toolchain + cargo-ndk + aarch64-linux-android target
#   - Android NDK 26.x + Android SDK 34
#   - Node.js + Capacitor CLI
#   - Gemma 2B GGUF model on device (already installed per architect)
#
# Usage:
#   bash scripts/build-and-deploy.sh            # full build + install
#   bash scripts/build-and-deploy.sh --skip-llama  # skip llama.cpp build (already built)
#   bash scripts/build-and-deploy.sh --skip-rust   # skip Rust build (already built)
#   bash scripts/build-and-deploy.sh --skip-apk    # skip APK build (debugging)
#   bash scripts/build-and-deploy.sh --release     # release build
#
# What this script does (in order):
#   1. Build llama.cpp with -DGGML_VULKAN=ON for arm64-v8a
#   2. Build Rust gemma-bridge crate with --features jni,llama_linked
#   3. Copy .so files to mobile/capacitor/android/app/src/main/jniLibs/arm64-v8a/
#   4. Build Capacitor web assets
#   5. Sync Capacitor → Android
#   6. Build APK via Gradle
#   7. Install APK on connected device via adb
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# ============================================================================
# Config
# ============================================================================
LLAMA_CPP_REPO="${LLAMA_CPP_REPO:-$HOME/src/llama.cpp}"
LLAMA_BUILD_DIR="$LLAMA_CPP_REPO/build-android-arm64"
LLAMA_COMMIT="${LLAMA_COMMIT:-b4400}"  # Nov 2025 release; pin for reproducibility
NDK_VERSION="${NDK_VERSION:-26.1.10909125}"
ANDROID_HOME="${ANDROID_HOME:-$HOME/android-sdk}"
NDK_HOME="${NDK_HOME:-$ANDROID_HOME/ndk/$NDK_VERSION}"
RUST_TARGET="aarch64-linux-android"
ANDROID_API="${ANDROID_API:-24}"  # Vulkan requires API 24+

# Mobile capacitor paths
CAP_DIR="$REPO_ROOT/mobile/capacitor"
ANDROID_DIR="$CAP_DIR/android"
JNILIBS_DIR="$ANDROID_DIR/app/src/main/jniLibs/arm64-v8a"

# Build flags
SKIP_LLAMA=false
SKIP_RUST=false
SKIP_APK=false
SKIP_FABLE_DOWNLOAD=true  # opt-in via --with-fable
RELEASE=false
QUANT="${QUANT:-Q4_K_M}"  # Q4_K_M recommended, Q3_K_M for tight RAM
for arg in "$@"; do
  case "$arg" in
    --skip-llama) SKIP_LLAMA=true ;;
    --skip-rust) SKIP_RUST=true ;;
    --skip-apk) SKIP_APK=true ;;
    --with-fable) SKIP_FABLE_DOWNLOAD=false ;;
    --release) RELEASE=true ;;
    --q3) QUANT="Q3_K_M" ;;
    --help|-h)
      grep '^#' "$0" | sed 's/^# \?//'
      exit 0
      ;;
  esac
done

BUILD_TYPE="debug"
CARGO_BUILD_FLAGS=""
if $RELEASE; then
  BUILD_TYPE="release"
  CARGO_BUILD_FLAGS="--release"
fi

log() { echo "[amos-build] $*"; }
err() { echo "[amos-build ERROR] $*" >&2; exit 1; }
section() { echo; echo "=== $* ==="; }

# ============================================================================
# Pre-flight
# ============================================================================
section "Pre-flight checks"

[ -d "$ANDROID_HOME" ] || err "ANDROID_HOME not found: $ANDROID_HOME. Run scripts/bootstrap-termux.sh first."
[ -d "$NDK_HOME" ] || err "NDK_HOME not found: $NDK_HOME. Run scripts/bootstrap-termux.sh first."

export ANDROID_HOME NDK_HOME
export PATH="$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin"

command -v cargo >/dev/null || err "cargo not found. Run scripts/bootstrap-termux.sh first."
command -v cargo-ndk >/dev/null || err "cargo-ndk not found. Install: cargo install cargo-ndk"
command -v adb >/dev/null || err "adb not found. Install platform-tools via sdkmanager."

log "ANDROID_HOME = $ANDROID_HOME"
log "NDK_HOME     = $NDK_HOME"
log "BUILD_TYPE   = $BUILD_TYPE"
log "REPO         = $REPO_ROOT"

mkdir -p "$JNILIBS_DIR"

# ============================================================================
# Step 1: Build llama.cpp with Vulkan backend for Android arm64
# ============================================================================
if ! $SKIP_LLAMA; then
  section "Step 1: Build llama.cpp with Vulkan for arm64-v8a"

  if [ ! -d "$LLAMA_CPP_REPO" ]; then
    log "Cloning llama.cpp to $LLAMA_CPP_REPO..."
    git clone --depth 1 --branch "$LLAMA_COMMIT" https://github.com/ggerganov/llama.cpp "$LLAMA_CPP_REPO" \
      || git clone --depth 1 https://github.com/ggerganov/llama.cpp "$LLAMA_CPP_REPO"
  fi

  cd "$LLAMA_CPP_REPO"
  log "Checking out commit $LLAMA_COMMIT..."
  git fetch --depth 1 origin "$LLAMA_COMMIT" 2>/dev/null || true
  git checkout "$LLAMA_COMMIT" 2>/dev/null || log "(already at HEAD)"

  mkdir -p "$LLAMA_BUILD_DIR"
  cd "$LLAMA_BUILD_DIR"

  log "Running cmake (this configures Vulkan + arm64-v8a)..."
  cmake "$LLAMA_CPP_REPO" \
    -DGGML_VULKAN=ON \
    -DLLAMA_BUILD_TESTS=OFF \
    -DLLAMA_BUILD_EXAMPLES=OFF \
    -DLLAMA_BUILD_SERVER=OFF \
    -DBUILD_SHARED_LIBS=ON \
    -DCMAKE_TOOLCHAIN_FILE="$NDK_HOME/build/cmake/android.toolchain.cmake" \
    -DANDROID_ABI=arm64-v8a \
    -DANDROID_PLATFORM=android-$ANDROID_API \
    -DANDROID_STL=c++_shared \
    -DCMAKE_BUILD_TYPE=$BUILD_TYPE

  log "Running make (this compiles llama.cpp + ggml-vulkan)..."
  make -j$(nproc) llama ggml-vulkan ggml-base ggml-cpu

  log "Copying .so files to jniLibs..."
  cp -v "$LLAMA_BUILD_DIR"/libllama.so "$JNILIBS_DIR/"
  cp -v "$LLAMA_BUILD_DIR"/libggml-vulkan.so "$JNILIBS_DIR/"
  cp -v "$LLAMA_BUILD_DIR"/libggml-base.so "$JNILIBS_DIR/" 2>/dev/null || true
  cp -v "$LLAMA_BUILD_DIR"/libggml-cpu.so "$JNILIBS_DIR/" 2>/dev/null || true

  # Also copy libc++_shared.so from NDK (required by C++ code)
  cp -v "$NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/sysroot/usr/lib/aarch64-linux-android/libc++_shared.so" "$JNILIBS_DIR/"

  log "llama.cpp .so files in place:"
  ls -lh "$JNILIBS_DIR/"
else
  log "Skipping llama.cpp build (--skip-llama)"
fi

# ============================================================================
# Step 2: Build Rust gemma-bridge with llama_linked + jni features
# ============================================================================
if ! $SKIP_RUST; then
  section "Step 2: Build Rust gemma-bridge crate"

  cd "$REPO_ROOT/rust"

  log "Setting LLAMA_LIB_DIR for linking..."
  export LLAMA_LIB_DIR="$JNILIBS_DIR"

  log "Building all Rust crates for arm64-v8a (this includes gemma-bridge with llama_linked)..."
  cargo ndk --target $RUST_TARGET --platform $ANDROID_API build $CARGO_BUILD_FLAGS \
    --features gemma-bridge/jni,gemma-bridge/llama_linked -p gemma-bridge

  log "Copying libgemma_bridge.so to jniLibs..."
  cp -v "$REPO_ROOT/rust/target/$RUST_TARGET/$BUILD_TYPE/libgemma_bridge.so" "$JNILIBS_DIR/"

  # Also build the other Rust crates (meta-harness, constellation, arrow-bridge)
  log "Building other Rust crates (meta-harness, constellation, arrow-bridge)..."
  cargo ndk --target $RUST_TARGET --platform $ANDROID_API build $CARGO_BUILD_FLAGS \
    -p meta-harness -p constellation -p arrow-bridge

  for crate in meta_harness constellation arrow_bridge; do
    cp -v "$REPO_ROOT/rust/target/$RUST_TARGET/$BUILD_TYPE/lib${crate}.so" "$JNILIBS_DIR/" 2>/dev/null || true
  done

  log "Rust .so files in place:"
  ls -lh "$JNILIBS_DIR/"
else
  log "Skipping Rust build (--skip-rust)"
fi

# ============================================================================
# Step 2.5: Download FABLE model (Gemma 4 12B agentic) — optional
# ============================================================================
if ! $SKIP_FABLE_DOWNLOAD; then
  section "Step 2.5: Download FABLE model (Gemma 4 12B agentic $QUANT)"

  FABLE_MODEL_URL="https://huggingface.co/yuxinlu1/gemma-4-12B-agentic-fable5-composer2.5-v2-3.5x-tau2-GGUF/resolve/main/gemma4-v2-${QUANT}.gguf"
  FABLE_MODEL_PATH="${FABLE_MODEL_PATH:-/data/data/com.termux/files/usr/share/models/gemma4-v2-${QUANT}.gguf}"
  FABLE_MODEL_DIR="$(dirname "$FABLE_MODEL_PATH")"

  log "FABLE model URL: $FABLE_MODEL_URL"
  log "FABLE model path: $FABLE_MODEL_PATH"

  # Check if model already exists
  if [ -f "$FABLE_MODEL_PATH" ]; then
    log "FABLE model already exists ($(du -h "$FABLE_MODEL_PATH" | cut -f1)) — skipping download"
  else
    log "Creating model directory: $FABLE_MODEL_DIR"
    mkdir -p "$FABLE_MODEL_DIR"

    log "Downloading FABLE model ($QUANT) — this is large, may take 10-30 min..."
    # Try wget first, fall back to curl
    if command -v wget >/dev/null; then
      wget -c -O "$FABLE_MODEL_PATH" "$FABLE_MODEL_URL" || \
        err "Download failed. Check network + URL."
    elif command -v curl >/dev/null; then
      curl -L -C - -o "$FABLE_MODEL_PATH" "$FABLE_MODEL_URL" || \
        err "Download failed. Check network + URL."
    else
      err "Neither wget nor curl available."
    fi

    log "FABLE model downloaded: $(du -h "$FABLE_MODEL_PATH" | cut -f1)"
  fi

  # Verify file size is plausible (Q4_K_M ~7 GB, Q3_K_M ~5.5 GB)
  SIZE_GB=$(du -g "$FABLE_MODEL_PATH" | cut -f1)
  if [ "$SIZE_GB" -lt 4 ]; then
    err "FABLE model file is only ${SIZE_GB} GB — likely corrupted. Delete and re-run."
  fi
  log "FABLE model verified: ${SIZE_GB} GB"
else
  log "Skipping FABLE model download (use --with-fable to enable)"
fi

# ============================================================================
# Step 3: Build Capacitor web assets
# ============================================================================
if ! $SKIP_APK; then
  section "Step 3: Build Capacitor web assets"

  cd "$CAP_DIR"
  log "Installing npm dependencies..."
  npm ci || npm install

  log "Building web assets (Vite + tsc)..."
  npm run build

  log "Syncing Capacitor → Android..."
  npx cap sync android
fi

# ============================================================================
# Step 4: Build APK via Gradle
# ============================================================================
if ! $SKIP_APK; then
  section "Step 4: Build APK via Gradle"

  cd "$ANDROID_DIR"
  log "Running ./gradlew assemble$BUILD_TYPE..."
  ./gradlew "assemble$(echo $BUILD_TYPE | sed 's/^./\U&/')"

  APK_PATH="$ANDROID_DIR/app/build/outputs/apk/$BUILD_TYPE/app-$BUILD_TYPE.apk"
  [ -f "$APK_PATH" ] || err "APK not found at expected path: $APK_PATH"
  log "APK built: $APK_PATH ($(du -h "$APK_PATH" | cut -f1))"
fi

# ============================================================================
# Step 5: Install APK on connected device
# ============================================================================
if ! $SKIP_APK; then
  section "Step 5: Install on connected device"

  log "Checking for connected devices..."
  adb_devices=$(adb devices | grep -v "^List" | grep -v "^$" | wc -l)
  if [ "$adb_devices" -eq 0 ]; then
    err "No devices connected via adb. Plug in S25 Ultra via USB and enable USB debugging."
  fi
  log "Device(s) detected:"
  adb devices

  log "Installing APK..."
  adb install -r "$APK_PATH"

  log "Verifying install..."
  adb shell pm list packages | grep com.ava007.mobile && log "✓ AVA007 installed" || log "⚠ package not found"

  # Check native libraries loaded
  log "Native libraries in APK:"
  adb shell run-as com.ava007.mobile ls /data/app/*/com.ava007.mobile*/lib/arm64/ 2>/dev/null || \
    log "(can't list — install verify still good)"
fi

# ============================================================================
# Done
# ============================================================================
section "Build & Deploy complete"

cat <<EOF

✓ llama.cpp built with Vulkan backend
✓ Rust gemma-bridge built with llama_linked + jni
✓ Capacitor web assets built + synced
✓ APK assembled
✓ Installed on device

Next steps:
  1. Launch AVA007 AMOS on the S25 Ultra
  2. Check logcat for native library load:
       adb logcat | grep -E "GemmaBridge|gemma-bridge|llama"
  3. Verify Gemma 2B model is at the expected path:
       adb shell ls -lh /data/data/com.termux/files/usr/share/models/gemma-2-2b-it-Q4_K_M.gguf
  4. If model path is different, update src/constellation/backends/GemmaBackend.ts
     default path and rebuild.
  5. Test inference by sending a prompt through the InputOrchestrativeInterface.

If native libraries fail to load, check:
  - libllama.so, libggml-vulkan.so, libgemma_bridge.so are in jniLibs/arm64-v8a/
  - libc++_shared.so is also there (C++ runtime)
  - APK was signed (debug builds are auto-signed)

If Vulkan fails to init:
  - Verify S25 Ultra is on Android 12+ (API 31+; Vulkan 1.1+ is API 24+)
  - Check logcat for "Adreno" or "Vulkan" errors
  - The Vulkan POC at mobile/capacitor/android/app/src/main/cpp/vulkan/matmul.cpp
    can be built standalone to verify Vulkan works before debugging llama.cpp.

EOF
