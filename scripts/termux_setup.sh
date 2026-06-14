#!/data/data/com.termux/files/usr/bin/bash
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Ava007 Edge Node — Termux Setup (S25 Ultra)
# Fixes: native module builds, Termux paths, cloudflared ARM64,
#         runit service, env loading, ping alternative
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# Don't use set -e in Termux — some pkg commands return non-zero spuriously

echo "=== Ava007 Termux Setup ==="
echo ""

# ─── 1. Package install ────────────────────────────────────────────
echo "[1/7] Updating packages..."
pkg update -y 2>/dev/null || true
pkg upgrade -y 2>/dev/null || true

echo "[1/7] Installing core packages..."
pkg install -y nodejs-lts python git openssl-tool termux-api 2>/dev/null || true

# inetutils provides ping (needed by BackhaulManager)
pkg install -y inetutils 2>/dev/null || true

# Build tools for native npm modules (better-sqlite3, serialport)
pkg install -y cmake make clang libandroid-spawn 2>/dev/null || true

# ─── 2. Cloudflared (ARM64) ───────────────────────────────────────
echo "[2/7] Installing cloudflared..."
if ! command -v cloudflared &>/dev/null; then
    wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64 \
        -O "$PREFIX/bin/cloudflared" 2>/dev/null && \
        chmod +x "$PREFIX/bin/cloudflared" && \
        echo "  cloudflared installed: $(cloudflared --version 2>&1 | head -1)" || \
        echo "  WARNING: cloudflared install failed — tunnel won't work"
else
    echo "  cloudflared already installed"
fi

# ─── 3. Clone repo ────────────────────────────────────────────────
REPO_URL="https://github.com/ingeniosity-A2A/QAG-MemBrain-.git"
REPO_DIR="$HOME/QAG_MemBrain"

echo "[3/7] Cloning repository..."
if [ ! -d "$REPO_DIR" ]; then
    git clone "$REPO_URL" "$REPO_DIR" || {
        echo "  Clone failed. Trying with personal token..."
        echo "  Run manually: git clone https://<TOKEN>@github.com/ingeniosity-A2A/QAG-MemBrain-.git $REPO_DIR"
    }
else
    echo "  Repository already exists, pulling latest..."
    cd "$REPO_DIR" && git pull 2>/dev/null || true
fi

cd "$REPO_DIR" || { echo "ERROR: Cannot cd to $REPO_DIR"; exit 1; }

# ─── 4. npm install ───────────────────────────────────────────────
echo "[4/7] Installing npm dependencies..."
# Termux: install non-native deps first, then try native ones
npm install --ignore-scripts 2>&1 || true
# Try building native modules (better-sqlite3, serialport) — OK if they fail
export CPPFLAGS="-P"
npm rebuild 2>&1 || {
    echo "  Some native modules failed to build — server will use fallbacks"
}
# Ensure ws types are present even if native modules failed
npm install ws @types/ws 2>&1 || true

# ─── 5. Build TypeScript ──────────────────────────────────────────
echo "[5/7] Building TypeScript..."
npm run build 2>&1 || { echo "ERROR: Build failed"; exit 1; }

# Verify build output
if [ ! -f "dist/main.js" ]; then
    echo "ERROR: dist/main.js not found — build did not produce output"
    exit 1
fi
echo "  Build OK: dist/main.js exists"

# ─── 6. Create .env ───────────────────────────────────────────────
echo "[6/7] Setting up .env..."
if [ ! -f .env ]; then
    cp .env.example .env
    echo "  Created .env from template — EDIT IT with your keys:"
    echo "    nano $REPO_DIR/.env"
else
    echo "  .env already exists"
fi

# ─── 7. Create runit service (Termux boot) ────────────────────────
echo "[7/7] Creating Termux boot service..."
TERMUX_BOOT_DIR="$HOME/.termux/boot"
mkdir -p "$TERMUX_BOOT_DIR"

cat > "$TERMUX_BOOT_DIR/avamembrain.sh" << 'SERVICEEOF'
#!/data/data/com.termux/files/usr/bin/bash
# Auto-start Ava007 MemBrain on device boot
export HOME=/data/data/com.termux/files/home
cd "$HOME/QAG_MemBrain" || exit 1

# Load env
while IFS='=' read -r key value; do
    # Skip comments and empty lines
    [[ "$key" =~ ^#.*$ ]] && continue
    [[ -z "$key" ]] && continue
    # Strip surrounding quotes
    value="${value%\"}"
    value="${value#\"}"
    export "$key"="$value"
done < .env

# Start gateway in background
"$HOME/QAG_MemBrain/scripts/start_gateway.sh" &
SERVICEEOF

chmod +x "$TERMUX_BOOT_DIR/avamembrain.sh"
echo "  Boot service created: $TERMUX_BOOT_DIR/avamembrain.sh"

# Also enable Termux:Boot if not already
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  SETUP COMPLETE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  NEXT STEPS:"
echo ""
echo "  1. Edit your .env:"
echo "     nano ~/QAG_MemBrain/.env"
echo ""
echo "  2. Test the server:"
echo "     ~/QAG_MemBrain/scripts/start_gateway.sh"
echo ""
echo "  3. Verify it's running (in another Termux session):"
echo "     curl http://localhost:8080/health"
echo ""
echo "  4. For auto-start on boot, install Termux:Boot from F-Droid"
echo ""
echo "  5. For Cloudflare tunnel auth:"
echo "     cloudflared tunnel login"
echo ""
echo "  QUICK TEST (no keys needed):"
echo "     cd ~/QAG_MemBrain && node dist/main.js"
echo ""
