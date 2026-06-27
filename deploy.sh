#!/usr/bin/env bash
#
# AVA007 — one-shot deploy script.
#
# Deploys the Cloudflare Worker, sets all secrets, provisions a Telnyx
# WhatsApp number, and prints the final AVA007 config.
#
# Prerequisites:
#   1. Node.js 18+ installed
#   2. Telnyx account + API key (https://portal.telnyx.com)
#   3. Cloudflare account + wrangler CLI authenticated
#
# Usage:
#   ./deploy.sh
#
# Env vars (or you'll be prompted):
#   TELNYX_API_KEY         — required
#   COUNTRY_CODE           — default "US"
#   AREA_CODE              — default "" (any)
#   PROFILE_NAME           — default "AVA007"
#   DEVICE_ID              — default "ava007-s26-ultra"

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKER_DIR="${SCRIPT_DIR}/cloudflare_mesh/worker"
TELNYX_SETUP_DIR="${SCRIPT_DIR}/telnyx/setup"

echo "╔════════════════════════════════════════════════════════════╗"
echo "║         AVA007 — Cloudflare + Telnyx Deploy                ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# ── Pre-flight ──────────────────────────────────────────────────────────────
command -v node >/dev/null 2>&1 || { echo "✗ Node.js not installed. Install from https://nodejs.org"; exit 1; }
command -v npx >/dev/null 2>&1 || { echo "✗ npx not available. Install Node.js first."; exit 1; }

# Check wrangler auth
echo "Pre-flight: checking wrangler auth..."
cd "${WORKER_DIR}"
if [ ! -d "node_modules" ]; then
  echo "  Installing dependencies..."
  npm install
fi

if ! npx wrangler whoami >/dev/null 2>&1; then
  echo "  ✗ wrangler not authenticated. Starting login flow..."
  npx wrangler login
fi
echo "  ✓ wrangler authenticated"
cd "${SCRIPT_DIR}"

# ── Step 1: Worker setup ────────────────────────────────────────────────────
echo ""
echo "── Step 1: Worker setup (KV + secrets + deploy) ──────────────"
cd "${WORKER_DIR}"
node scripts/setup.js
cd "${SCRIPT_DIR}"

# Capture the Worker URL from the last deploy output
# (setup.js prints it, but to capture it reliably we re-query)
WORKER_URL=$(npx wrangler deployments list --env production 2>/dev/null | grep -oE 'https://[a-z0-9-]+\.workers\.dev' | head -1 || echo "")

if [ -z "${WORKER_URL}" ]; then
  echo ""
  echo "  Paste the Worker URL from above (e.g. https://ava007-proxy.xyz.workers.dev):"
  read -r WORKER_URL
fi

echo ""
echo "  ✓ Worker URL: ${WORKER_URL}"

# ── Step 2: Telnyx provisioning ─────────────────────────────────────────────
echo ""
echo "── Step 2: Telnyx WhatsApp number provisioning ───────────────"

if [ -z "${TELNYX_API_KEY:-}" ]; then
  echo "  Enter your Telnyx API key (from https://portal.telnyx.com/#/app/api-keys):"
  read -r TELNYX_API_KEY
fi

export TELNYX_API_KEY
export WEBHOOK_URL="${WORKER_URL}"

cd "${TELNYX_SETUP_DIR}"
node provision.js

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║                  DEPLOY COMPLETE                           ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "Next: set these env vars on your AVA007 device (Termux):"
echo "  export AVA007_WORKER_URL=${WORKER_URL}"
echo "  export AVA007_DEVICE_TOKEN=<from setup output above>"
echo "  export AVA007_WEBHOOK_SECRET=<from setup output above>"
echo "  export AVA007_WHATSAPP_FROM=<phone number from provisioning>"
echo "  export AVA007_WHATSAPP_PHONE_ID=<phone_number_id from provisioning>"
echo ""
echo "Then start AVA007:"
echo "  cargo run --release -p mobile_runtime"
