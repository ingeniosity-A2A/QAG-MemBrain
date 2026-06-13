#!/usr/bin/env bash
# Starts the Ava007 MemBrain server, Cloudflare tunnel, and optional Telnyx SIP client.

set -e

cd "$(dirname "$0")/.."

# Load environment variables
if [ -f .env ]; then
    set -a
    source .env
    set +a
fi

CLOUDTUNNEL_PID=""
SIP_PID=""

# Start Cloudflare tunnel if CLOUDFLARE_TUNNEL_TOKEN is set
if [ -n "$CLOUDFLARE_TUNNEL_TOKEN" ] && command -v cloudflared &> /dev/null; then
    echo "Starting Cloudflare tunnel..."
    cloudflared tunnel run --token "$CLOUDFLARE_TUNNEL_TOKEN" &
    CLOUDTUNNEL_PID=$!
elif [ -n "$CLOUDFLARE_TUNNEL_ID" ] && command -v cloudflared &> /dev/null; then
    echo "Starting Cloudflare tunnel: $CLOUDFLARE_TUNNEL_ID"
    cloudflared tunnel --url http://localhost:8080 run "$CLOUDFLARE_TUNNEL_ID" &
    CLOUDTUNNEL_PID=$!
fi

# Start Telnyx SIP client (optional)
if [ -n "$TELNYX_SIP_USER" ] && [ -f "scripts/sip_client.py" ]; then
    echo "Starting Telnyx SIP client..."
    python3 scripts/sip_client.py &
    SIP_PID=$!
fi

# Start the MemBrain Node.js server
echo "Starting MemBrain server on port ${PORT:-8080}..."
node --env-file=.env dist/main.js

# Cleanup on exit
trap "kill $CLOUDTUNNEL_PID $SIP_PID 2>/dev/null" EXIT
