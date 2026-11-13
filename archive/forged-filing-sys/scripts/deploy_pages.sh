#!/bin/sh
# Deploy the AVA007 agent browser to Cloudflare Pages.
#
# Project: ai-browser  (production: https://ai-browser.pages.dev)
# Domain:  ai.ingeniosity.tech  (custom domain — dashboard: Pages → ai-browser →
#          Custom domains → Set up a custom domain)
#
# Deploys static assets from dist/ plus Pages Functions from functions/api/
# (wrangler bundles the repo-root functions/ directory automatically).
#
# Requires CLOUDFLARE_API_TOKEN in the environment (wrangler reads it directly).
# Usage: sh ./scripts/deploy_pages.sh
set -eu

sh ./scripts/build_pages.sh

npx --yes wrangler@latest pages deploy dist \
  --project-name=ai-browser \
  --branch=main \
  --commit-dirty=true

echo "deployed: https://ai-browser.pages.dev -> ai.ingeniosity.tech"
echo "chat backend: /api/chat (DEV-locked until HUGGINGFACE_TOKEN is set on the Pages project)"
echo "ingest backend: /api/ingest"
