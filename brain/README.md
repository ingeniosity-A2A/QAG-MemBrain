# Dual Brain Cognition (Layer 3)

Reflex (on‑device), executive (cloud), and cortex (learning) layers.

## Subdirectories
- `/reflex` – Gemma 2‑9B / GLM running on S25 Ultra NPU (Neural Processing Unit). Real‑time decisions.
- `/executive` – Watsonx / larger Gemma in cloud. Planning, routing, identity.
- `/cortex` – Learning engine. Reads telemetry, outputs new policies and embeddings.

## Communication
- Reflex writes JSONL memories → Tashi gossips to cloud.
- Executive reads reconstructed state from GSAP timeline.
- Cortex writes updated policies as new JSONL vertices.

## Example
See `docs/specifications/dual-brain-flow.md` for the handshake between layers.
