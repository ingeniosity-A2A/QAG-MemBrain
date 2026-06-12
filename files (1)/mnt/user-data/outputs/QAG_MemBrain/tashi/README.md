# /tashi — Distributed DAG Consensus (Layer 1)

Leaderless consensus over signed JSONL atoms. Tashi does not care whether an atom
came from an NFC tap, an A2A POST, or a document upload. It signs, gossips, and appends.

## /dag
Vertex structure and DAG traversal. Each vertex contains a signed JSONL atom,
a `parent_hashes[]` array, and the node's DID + Ed25519 signature.
Orphaned vertices (no valid parent hash) are rejected.

## /gossip
WebRTC/WebSocket epidemic broadcast transport. Peer discovery and NAT punching.
The Rust sidecar (`tashi-vertex-rs`) lives here.

## /consensus
Offline queue buffers vertices when the mesh is unavailable.
On reconnect, queue flushes in order. Policy conflicts escalate to cortex.

## Internal HTTP API
```
POST /vertex        Submit a new signed vertex
GET  /dag/{hash}    Retrieve vertex and ancestors
WS   /gossip        Join the mesh and receive live updates
```
