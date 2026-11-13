/* AVA007 agent browser — minimal offline shell service worker.
   Strategy: network-first for pages/functions, cache-first for static assets.
   Three-color governance is a presentation concern; this worker only governs
   asset lifetime. Bump the version to invalidate. */
const VERSION = "ava007-agent-browser-v1.2.1";
const BASE = self.registration.scope;
const SHELL = [
  "",
  "manifest.webmanifest",
  "icon.svg",
  "native-layer.js",
  "browser-kernel.js",
].map((p) => BASE + p);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // functions: always live

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((res) => {
          if (res.ok && res.type === "basic") {
            const copy = res.clone();
            caches.open(VERSION).then((cache) => cache.put(event.request, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network; // stale-while-revalidate flavor
    })
  );
});
