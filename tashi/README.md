# Tashi Vertex Consensus (Layer 1)

Rust‑based DAG with gossip protocol, NAT punching, and DID signatures.

## Subdirectories
- `/dag` – Vertex structure, parent hashing, DAG traversal.
- `/gossip` – WebRTC/WebSocket transport, peer discovery, epidemic broadcast.
- `/consensus` – Leaderless agreement, offline queue, replay on reconnect.

## Integration
- Each vertex contains a signed JSONL line from `/memory/jsonl`.
- Tashi runs as a sidecar binary (Rust) on S25 Ultra (Samsung Galaxy S25 Ultra mobile device) and cloud supernodes.

## Key APIs (exposed to Go/Python via HTTP)
- `POST /vertex` – Submit a new signed vertex.
- `GET /dag/{hash}` – Retrieve vertex and its ancestors.
- `WS /gossip` – Join the mesh and receive live updates.
