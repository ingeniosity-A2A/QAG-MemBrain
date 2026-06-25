#!/usr/bin/env bash
#
# AMOS v2.9 — Serve YOUR custom UI wired to local llama-server
#
# No build step. No React. No Vite. Just your HTML + llama-server.
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

log() { echo "[ava007] $*"; }

# Check index.html exists
if [ ! -f "index.html" ]; then
  echo "ERROR: index.html not found in $REPO_ROOT"
  exit 1
fi

log "AVA007 custom UI found: index.html ($(wc -c < index.html) bytes)"

# Check llama-server is running
if ! curl -s http://localhost:8080/v1/models >/dev/null 2>&1; then
  log "WARNING: llama-server not detected on port 8080"
  log "Start it first: llama-server -m ~/gemma-2b.gguf --port 8080 --host 0.0.0.0"
  log "Continuing anyway (UI will show errors until llama-server starts)..."
fi

# Create server
cat > ava-server.mjs << 'SERVER'
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { extname, join } from 'path';

const PORT = 9000;
const ROOT = '.';
const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.ico': 'image/x-icon',
};

const server = createServer(async (req, res) => {
  let path = req.url === '/' ? '/index.html' : req.url;
  const filePath = join(ROOT, path);
  try {
    const content = await readFile(filePath);
    res.setHeader('Content-Type', MIME[extname(filePath)] || 'application/octet-stream');
    res.writeHead(200);
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('================================================');
  console.log('  AVA007 AMOS — LIVE');
  console.log('');
  console.log('  UI:         http://localhost:' + PORT);
  console.log('  Inference:  http://localhost:8080 (llama-server)');
  console.log('  Model:      Gemma 2B (local, sovereign)');
  console.log('');
  console.log('  Open Chrome and go to http://localhost:' + PORT);
  console.log('================================================');
  console.log('');
});
SERVER

log "Starting server..."
exec node ava-server.mjs
