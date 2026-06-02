# QAG_MemBrain Repository Charter

## Mission
QAG_MemBrain is the authoritative memory and cognition architecture for the AVA‑007 system. It implements deterministic temporal memory, distributed consensus, and dual‑brain orchestration.

## Core Principles
1. Memory is reconstructed, not stored. State is derived from transition laws (tween atoms) and temporal coordinates.
2. JSONL is the atomic memory substrate. One line = one immutable, typed, signed memory.
3. Tashi DAG provides leaderless consensus. Vertices are signed JSONL lines, gossiped over WebRTC/WebSocket.
4. GSAP is the temporal orchestration engine. Timelines encode transition functions; easing = probability.
5. Dual‑brain (Gemma + Watsonx) executes reflex, executive, and cortex layers.
6. Deterministic replay guarantees auditability. Any state can be reconstructed at any time.
7. Offline‑first. Local JSONL + Tashi queue, sync when connectivity returns.

## What Belongs Here
- JSONL schema and management (`/memory`)
- Tashi DAG, gossip, consensus (`/tashi`)
- GSAP timeline serialization and replay (`/temporal`)
- Reflex, executive, cortex processing (`/brain`)
- Vector retrieval and embeddings (`/retrieval`)
- Audit logging and learning pipelines (`/memory/audit`, `/memory/learning`)
- Public API and SDK for external consumers (`/interfaces`)
- Tests and benchmarks (`/tests`)
- Documentation and architecture specs (`/docs`)
- Archived legacy references (`/archive`)

## What Does NOT Belong Here
- UI components (customer surface, docking station, weather, chat)
- Runtime rendering engines (Three.js scene setup, spatial canvas, sonification UI)
- Customer‑facing applications or developer consoles
- Experiments not directly related to memory/cognition architecture
- Any presentation logic

## Relationship with Other Repositories
| Repository | Role | Consumes QAG_MemBrain |
|------------|------|------------------------|
| `ava-surface` | Customer UI and developer surfaces | Yes, via `/interfaces/api` |
| `ava-runtime` (optional) | 6D engine, Three.js, audio, lens | Yes, for temporal state |
| Legacy repos | Read‑only archives | No active development |

## Governance
- All changes must maintain deterministic replay.
- Every memory mutation must be signed (DID) and appended to JSONL.
- Tashi vertices must reference parent hashes.
- No UI code shall be merged.
- API versioning: semantic versioning for `/interfaces`.

## Success Criteria
- [ ] Deterministic replay test: same timeline definition + start time → identical state.
- [ ] Offline sync: Tashi queue flushes correctly on reconnect.
- [ ] DID signatures verified on every vertex.
- [ ] Audit log contains all inputs, outputs, reasoning.
- [ ] No UI or runtime rendering dependencies in production build.
