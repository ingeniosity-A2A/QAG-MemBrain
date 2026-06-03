# Tashi Vertex Consensus (Layer 1)

Rust-based DAG with gossip protocol, NAT punching, and DID signatures.

## Subdirectories
- /dag: Vertex structure, parent hashing, DAG traversal
- /gossip: WebRTC/WebSocket transport, discovery, broadcast
- /consensus: Leaderless agreement, offline queue, replay on reconnect

## Integration
Each vertex contains a signed JSONL line from /memory/jsonl.

## Key APIs
- POST /vertex: Submit signed vertex
- GET /dag/{hash}: Retrieve vertex and ancestors
- WS /gossip: Join mesh and receive updates
