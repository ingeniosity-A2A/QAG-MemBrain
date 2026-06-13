#!/usr/bin/env bash
# Repository setup: installs Node.js dependencies, builds TypeScript, creates .env template.

set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "=== QAG_MemBrain Repository Setup ==="

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "Node.js not found. Please install Node.js 20+ first."
    exit 1
fi

echo "Installing npm dependencies..."
npm install

echo "Building TypeScript project..."
npm run build

# Create .env from example if not exists
if [ ! -f .env ]; then
    cp .env.example .env
    echo "Created .env file. Please edit it with your keys (Cloudflare, Telnyx, etc.)."
fi

echo "Setup complete. Run 'npm start' to launch the MemBrain server."
