#!/usr/bin/env bash
#
# AMOS v2.8 — Bootstrap: Termux + Ubuntu proot + Android SDK + NDK + Rust + Capacitor
#
# This script runs in TWO phases:
#   Phase 1 (in Termux): Install proot-distro + Ubuntu + basic tools
#   Phase 2 (in Ubuntu): Install Rust + Android SDK + NDK + cargo-ndk + Capacitor CLI
#
# Usage:
#   bash scripts/bootstrap-termux.sh           # full setup
#   bash scripts/bootstrap-termux.sh --verify  # check what's installed
#   bash scripts/bootstrap-termux.sh --phase2  # run only Phase 2 (already inside Ubuntu)
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_FILE="$HOME/.amos-bootstrap.log"
ANDROID_API="34"
ANDROID_BUILD_TOOLS="34.0.0"
NDK_VERSION="26.1.10909125"

VERIFY_ONLY=false
PHASE2_ONLY=false
for arg in "$@"; do
  case "$arg" in
    --verify) VERIFY_ONLY=true ;;
    --phase2) PHASE2_ONLY=true ;;
    --help|-h)
      grep '^#' "$0" | sed 's/^# \?//'
      exit 0
      ;;
  esac
done

log() { echo "[amos] $*" | tee -a "$LOG_FILE"; }
err() { echo "[amos ERROR] $*" >&2 | tee -a "$LOG_FILE"; exit 1; }
section() { echo; echo "=== $* ===" | tee -a "$LOG_FILE"; }
check_cmd() { command -v "$1" >/dev/null 2>&1; }
installed() { check_cmd "$1" && echo "  OK $1" || echo "  MISSING $1"; }

# Detect environment
IN_TERMUX=false
IN_UBUNTU=false
if [ -n "${TERMUX_VERSION:-}" ] || [ -d "/data/data/com.termux" ]; then
  IN_TERMUX=true
elif check_cmd apt && [ -f "/etc/lsb-release" ] && grep -q Ubuntu /etc/lsb-release 2>/dev/null; then
  IN_UBUNTU=true
fi

# ============================================================================
# PHASE 1: Termux setup (run from Termux directly)
# ============================================================================
if ! $PHASE2_ONLY; then
  section "Phase 1: Termux setup"

  if $IN_UBUNTU; then
    log "Already inside Ubuntu — skipping Phase 1"
    log "If you need to run Phase 1, exit Ubuntu (type 'exit') and re-run this script"
  elif $IN_TERMUX || check_cmd pkg; then
    log "Running inside Termux"

    if ! $VERIFY_ONLY; then
      log "Updating packages..."
      pkg update -y && pkg upgrade -y

      log "Installing base packages..."
      pkg install -y python rustup git wget curl unzip zip openjdk-17 proot-distro termux-api

      log "Installing Ubuntu proot-distro..."
      if ! proot-distro list 2>/dev/null | grep -q "ubuntu.*installed"; then
        proot-distro install ubuntu
      else
        log "Ubuntu proot already installed"
      fi
    fi

    log "Phase 1 verification:"
    installed git
    installed curl
    installed wget
    installed unzip
    installed java
    installed proot-distro

    log ""
    log "Phase 1 complete."
    log ""
    log "═══════════════════════════════════════════════════════════════"
    log "  NEXT STEP: Enter Ubuntu proot and run Phase 2:"
    log ""
    log "    proot-distro login ubuntu"
    log ""
    log "  Then inside Ubuntu:"
    log ""
    log "    cd $(echo $REPO_ROOT | sed 's|/data/data/com.termux/files|/data/data/com.termux/files|')"
    log "    bash scripts/bootstrap-termux.sh --phase2"
    log ""
    log "  (Or if the repo is inside Termux home, it will be at:"
    log "    /data/data/com.termux/files/home/QAG-MemBrain-)"
    log "═══════════════════════════════════════════════════════════════"
    log ""
    log "After Phase 2 completes, exit Ubuntu (type 'exit') and run:"
    log "    bash scripts/build-and-deploy.sh"
    log ""
    exit 0
  else
    log "Not in Termux or Ubuntu — assuming generic Linux"
    if ! $VERIFY_ONLY; then
      if check_cmd apt; then
        sudo apt update -y
        sudo apt install -y python3 curl git wget unzip zip openjdk-17-jdk build-essential
      fi
    fi
  fi
fi

# ============================================================================
# PHASE 2: Ubuntu proot setup (run from inside Ubuntu)
# ============================================================================
section "Phase 2: Ubuntu setup (SDK + NDK + Rust + Capacitor)"

if ! $IN_UBUNTU && ! $PHASE2_ONLY; then
  log "Not inside Ubuntu — but continuing anyway (generic Linux path)"
fi

# Config
ANDROID_HOME="${ANDROID_HOME:-$HOME/android-sdk}"
NDK_HOME="${NDK_HOME:-$ANDROID_HOME/ndk/$NDK_VERSION}"
RUST_TARGET="aarch64-linux-android"

log "ANDROID_HOME = $ANDROID_HOME"
log "NDK_HOME     = $NDK_HOME"
log "RUST_TARGET  = $RUST_TARGET"

# --- 2.1: apt packages ---
section "Phase 2.1: apt packages"
if check_cmd apt; then
  if ! $VERIFY_ONLY; then
    log "Installing build tools..."
    apt update -y 2>/dev/null || sudo apt update -y
    apt install -y build-essential cmake ninja-build pkg-config \
      libssl-dev libclang-dev curl git wget unzip zip \
      openjdk-17-jdk 2>/dev/null || \
    sudo apt install -y build-essential cmake ninja-build pkg-config \
      libssl-dev libclang-dev curl git wget unzip zip \
      openjdk-17-jdk
  fi
fi
log "Phase 2.1 verification:"
installed cmake
installed ninja
installed gcc
installed java
installed pkg-config

# --- 2.2: Rust toolchain ---
section "Phase 2.2: Rust toolchain"
if ! check_cmd rustup; then
  log "Installing rustup..."
  if ! $VERIFY_ONLY; then
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable --profile minimal
    source "$HOME/.cargo/env"
  fi
else
  log "rustup already installed"
  source "$HOME/.cargo/env" 2>/dev/null || true
fi

if ! check_cmd cargo; then
  source "$HOME/.cargo/env"
fi

if ! $VERIFY_ONLY; then
  log "Adding Android target: $RUST_TARGET"
  rustup target add "$RUST_TARGET" || err "Failed to add Rust target"

  log "Installing cargo-ndk..."
  cargo install cargo-ndk || err "Failed to install cargo-ndk"
fi

log "Phase 2.2 verification:"
installed rustup
installed cargo
installed rustc
installed cargo-ndk

# --- 2.3: Android SDK + NDK ---
section "Phase 2.3: Android SDK + NDK"
mkdir -p "$ANDROID_HOME"
export ANDROID_HOME
export ANDROID_SDK_ROOT="$ANDROID_HOME"

CMDLINE_TOOLS_URL="https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip"
CMDLINE_TOOLS_DIR="$ANDROID_HOME/cmdline-tools/latest"

if [ ! -d "$CMDLINE_TOOLS_DIR" ]; then
  log "Installing Android command-line tools..."
  if ! $VERIFY_ONLY; then
    TMP_ZIP="$(mktemp -d)/cmdline-tools.zip"
    wget -q -O "$TMP_ZIP" "$CMDLINE_TOOLS_URL"
    unzip -q "$TMP_ZIP" -d "$ANDROID_HOME/"
    mkdir -p "$CMDLINE_TOOLS_DIR"
    if [ -d "$ANDROID_HOME/cmdline-tools/bin" ]; then
      mv "$ANDROID_HOME/cmdline-tools/bin" "$CMDLINE_TOOLS_DIR/"
      [ -d "$ANDROID_HOME/cmdline-tools/lib" ] && mv "$ANDROID_HOME/cmdline-tools/lib" "$CMDLINE_TOOLS_DIR/"
      [ -f "$ANDROID_HOME/cmdline-tools/NOTICE.txt" ] && mv "$ANDROID_HOME/cmdline-tools/NOTICE.txt" "$CMDLINE_TOOLS_DIR/"
      [ -f "$ANDROID_HOME/cmdline-tools/source.properties" ] && mv "$ANDROID_HOME/cmdline-tools/source.properties" "$CMDLINE_TOOLS_DIR/"
    fi
    rm -rf "$TMP_ZIP"
  fi
else
  log "Android command-line tools already installed"
fi

export PATH="$PATH:$CMDLINE_TOOLS_DIR/bin"

if ! $VERIFY_ONLY; then
  log "Accepting SDK licenses..."
  yes | sdkmanager --licenses >/dev/null 2>&1 || true

  log "Installing platform-tools, platforms;android-$ANDROID_API, build-tools;34.0.0, ndk;$NDK_VERSION..."
  sdkmanager \
    "platform-tools" \
    "platforms;android-$ANDROID_API" \
    "build-tools;$ANDROID_BUILD_TOOLS" \
    "ndk;$NDK_VERSION"
fi

export NDK_HOME
export PATH="$PATH:$NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/bin"

log "Phase 2.3 verification:"
[ -d "$ANDROID_HOME/platform-tools" ] && log "  OK platform-tools" || log "  MISSING platform-tools"
[ -d "$ANDROID_HOME/platforms/android-$ANDROID_API" ] && log "  OK platforms;android-$ANDROID_API" || log "  MISSING platforms;android-$ANDROID_API"
[ -d "$NDK_HOME" ] && log "  OK ndk;$NDK_VERSION" || log "  MISSING ndk;$NDK_VERSION"

# --- 2.4: Node.js + Capacitor CLI ---
section "Phase 2.4: Node.js + Capacitor CLI"
if ! check_cmd node; then
  log "Installing Node.js via nvm..."
  if ! $VERIFY_ONLY; then
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    nvm install --lts
    nvm use --lts
  fi
else
  log "Node.js already installed: $(node --version)"
fi

if ! $VERIFY_ONLY; then
  log "Installing Capacitor CLI globally..."
  npm install -g @capacitor/cli
fi

log "Phase 2.4 verification:"
installed node
installed npm

# --- 2.5: Environment file ---
section "Phase 2.5: Environment file"
ENV_FILE="$HOME/.amos-env"
log "Writing env file to $ENV_FILE..."
cat > "$ENV_FILE" <<EOF
# AMOS v2.8 build environment — source this before building
# Usage: source ~/.amos-env

export ANDROID_HOME="$ANDROID_HOME"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export NDK_HOME="$NDK_HOME"
export PATH="\$PATH:\$ANDROID_HOME/cmdline-tools/latest/bin:\$ANDROID_HOME/platform-tools:\$NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/bin"

# Rust
source "\$HOME/.cargo/env" 2>/dev/null || true

# nvm
export NVM_DIR="\$HOME/.nvm"
[ -s "\$NVM_DIR/nvm.sh" ] && \. "\$NVM_DIR/nvm.sh" 2>/dev/null || true

# Verify
echo "[amos] ANDROID_HOME=\$ANDROID_HOME"
echo "[amos] NDK_HOME=\$NDK_HOME"
echo "[amos] cargo: \$(cargo --version 2>/dev/null || echo MISSING)"
echo "[amos] cap: \$(cap --version 2>/dev/null || echo MISSING)"
EOF
chmod +x "$ENV_FILE"

# ============================================================================
# Done
# ============================================================================
section "Phase 2 complete"

log ""
log "═══════════════════════════════════════════════════════════════"
log "  Bootstrap complete!"
log ""
log "  To start a new shell with the environment loaded:"
log "    source $ENV_FILE"
log ""
log "  NEXT STEPS:"
log ""
log "  1. Exit Ubuntu proot (type 'exit')"
log "  2. Back in Termux, run the build:"
log "       cd ~/QAG-MemBrain-"
log "       bash scripts/build-and-deploy.sh"
log ""
log "  The build script will:"
log "    - Build llama.cpp with Vulkan for arm64-v8a"
log "    - Build Rust gemma-bridge with llama.cpp FFI"
log "    - Copy .so files to jniLibs/"
log "    - Build Capacitor web assets"
log "    - Build APK via Gradle"
log "    - Install on device via adb"
log ""
log "  Note: build-and-deploy.sh runs INSIDE Ubuntu proot."
log "  It needs all the tools from Phase 2."
log "═══════════════════════════════════════════════════════════════"
log ""
log "Log file: $LOG_FILE"
