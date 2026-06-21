# WASM Sandbox Modules — AMOS v2.1

This directory holds ArrowJS Sandbox modules for the **EPOCH** pillar (structured
adaptive presentation). All sandbox outputs are routed through Meta Harness before
execution.

## Planned modules

- `liteparse.wasm` — document parser (PDF, DOCX, PPTX, HTML)
- `gsap-renderer.wasm` — GSAP frame generator (offloaded from JS)
- `arrow-transform.wasm` — Arrow record batch transforms
- `merkle-hash.wasm` — TASHI audit trail hashing

## Build

```bash
cd wasm/<module>
wasm-pack build --target web --release
```

Output goes to `wasm/<module>/pkg/` and is consumed by `mobile/capacitor/src/`.

## Status

**Placeholder** — no modules implemented yet. Track implementation in
`mobile/MANIFEST.md`.
