#!/data/data/com.termux/files/usr/bin/bash
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Ava007 Gateway Launcher — Termux compatible
# Starts MemBrain server, optional Cloudflare tunnel, optional SIP
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

REPO_DIR="$HOME/QAG_MemBrain"
cd "$REPO_DIR" || { echo "ERROR: Cannot find $REPO_DIR"; exit 1; }

# ─── Load .env (Termux-safe — no set -a) ─────────────────────────
if [ -f .env ]; then
    while IFS='=' read -r key value; do
        [[ "$key" =~ ^#.*$ ]] && continue
        [[ -z "$key" ]] && continue
        # Strip surrounding quotes
        value="${value%\"}"
        value="${value#\"}"
        export "$key"="$value"
    done < .env
    echo "[Gateway] .env loaded"
else
    echo "[Gateway] WARNING: No .env file found"
fi

CLOUDTUNNEL_PID=""
SIP_PID=""

# ─── Cloudflare tunnel ───────────────────────────────────────────
if [ -n "$CLOUDFLARE_TUNNEL_TOKEN" ] && command -v cloudflared &>/dev/null; then
    echo "[Gateway] Starting Cloudflare tunnel..."
    cloudflared tunnel run --token "$CLOUDFLARE_TUNNEL_TOKEN" &
    CLOUDTUNNEL_PID=$!
    sleep 3
elif [ -n "$CLOUDFLARE_TUNNEL_ID" ] && command -v cloudflared &>/dev/null; then
    echo "[Gateway] Starting Cloudflare tunnel: $CLOUDFLARE_TUNNEL_ID"
    cloudflared tunnel --url http://localhost:8080 run "$CLOUDFLARE_TUNNEL_ID" &
    CLOUDTUNNEL_PID=$!
    sleep 3
else
    echo "[Gateway] No Cloudflare tunnel configured — local-only mode"
fi

# ─── Telnyx SIP client (optional) ────────────────────────────────
if [ -n "$TELNYX_SIP_USER" ] && [ -f "scripts/sip_client.py" ]; then
    echo "[Gateway] Starting Telnyx SIP client..."
    python3 scripts/sip_client.py &
    SIP_PID=$!
fi

# ─── Start MemBrain ──────────────────────────────────────────────
echo "[Gateway] Starting MemBrain server on port ${PORT:-8080}..."
echo ""

node dist/main.js

# ─── Cleanup on exit ─────────────────────────────────────────────
trap 'kill $CLOUDTUNNEL_PID $SIP_PID 2>/dev/null; echo "[Gateway] Stopped"' EXIT
