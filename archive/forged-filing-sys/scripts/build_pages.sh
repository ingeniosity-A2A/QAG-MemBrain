#!/bin/sh
# Cloudflare Pages build — AVA007 agent browser (Forged File explorer).
#
# Stage the whole consolidated surface into dist/:
#   index.html            explorer (chat dock, ingest sheet, PWA head)
#   native-layer.js       deferred bootstrap (chat/ingest wiring)
#   manifest.webmanifest  PWA manifest (installable home-screen app)
#   icon.svg              app icon (three-color locked)
#   sw.js                 offline-shell service worker
# No dependencies, no framework build — exits after producing dist/.
set -eu

SRC=docs/consolidated
mkdir -p dist

cp "$SRC/forged-file-explorer.html" dist/index.html
cp "$SRC/native-layer.js" "$SRC/manifest.webmanifest" "$SRC/icon.svg" "$SRC/sw.js" "$SRC/browser-kernel.js" dist/

# Pages Functions: bundled by wrangler from functions/, but stage a copy so the
# build output is a complete, servable snapshot of the deployed surface.
if [ -d functions ]; then
  mkdir -p dist/_functions
  cp -R functions/. dist/_functions/
fi

echo "pages build: dist/ ready ($(find dist -type f | wc -l) files, index $(wc -c < dist/index.html) bytes)"
