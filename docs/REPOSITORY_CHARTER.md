# QAG_MemBrain Repository Charter

## Mission
QAG_MemBrain is the authoritative memory and cognition architecture for the AVA-007 system. It implements deterministic temporal memory, distributed consensus, and dual-brain orchestration.

## Core Principles
1. Memory is reconstructed, not stored. State is derived from transition laws and temporal coordinates.
2. JSONL is the atomic memory substrate. One line is one immutable, typed, signed memory.
3. Tashi DAG provides leaderless consensus. Vertices are signed JSONL lines, gossiped over WebRTC/WebSocket.
4. GSAP is the temporal orchestration engine. Timelines encode transition functions; easing encodes probability.
5. Dual-brain (Gemma + Watsonx) executes reflex, executive, and cortex layers.
6. Deterministic replay guarantees auditability. Any state can be reconstructed at any time.
7. Offline-first. Local JSONL and Tashi queue, then sync when connectivity returns.

## Architectural Invariant
No subsystem may become a second source of truth.

Canonical ownership:

- JSONL -> Memory
- Replay -> Reconstruction
- Tashi -> Trust
- Spatial Cortex -> Meaning
- Temporal Kernel -> Time
- Memory Judge -> Validation

Everything else is derived.

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
- Customer-facing applications or developer consoles
- Experiments not directly related to memory/cognition architecture
- Presentation logic

## Relationship with Other Repositories
| Repository | Role | Consumes QAG_MemBrain |
|------------|------|------------------------|
| ava-surface | Customer UI and developer surfaces | Yes, via /interfaces/api |
| ava-runtime (optional) | 6D engine, Three.js, audio, lens | Yes, for temporal state |
| Legacy repos | Read-only archives | No active development |

## Replay Contract
Replay artifacts are authoritative reconstruction assets.

Artifacts:

- replay.jsonl
- replay.dedup.jsonl
- replay.segments.jsonl
- replay.checkpoints.jsonl

Capabilities:

- deterministic replay
- branch creation
- rollback
- temporal verification
- memory reconstruction

Replay is generated from JSONL and never replaces JSONL.

## Spatial Cortex Contract
Spatial Cortex converts replay and memory records into:

- MemoryAtoms
- Relationships
- Reconstruction Chains

Spatial Cortex is deterministic.
Delete Neo4j, replay JSONL, rebuild Spatial Cortex, system must recover.

## Memory Judge Contract
Purpose: measure reconstruction quality.

Pipeline:
Challenge -> Weak Solver -> Strong Solver -> Judge -> Score

Acceptance:
strongScore >= weakScore * 1.20

## Governance
- All changes must maintain deterministic replay.
- Every memory mutation must be signed (DID) and appended to JSONL.
- Tashi vertices must reference parent hashes.
- No UI code shall be merged.
- API versioning uses semantic versioning for /interfaces.

## Codespaces First Task
EPIC-001: Establish Canonical Ownership

Create and enforce docs/architecture/MEMORY_INTELLIGENCE_MODEL.md ownership boundaries:

- JSONL = memory
- Replay = reconstruction
- Tashi = trust
- Spatial Cortex = meaning
- Temporal Kernel = time
- Memory Judge = validation

No duplicate ownership allowed.

## Success Criteria
- [ ] Deterministic replay test: same timeline definition plus same start time produces identical state.
- [ ] Offline sync: Tashi queue flushes correctly on reconnect.
- [ ] DID signatures verified on every vertex.
- [ ] Audit log contains all inputs, outputs, reasoning.
- [ ] No UI or runtime rendering dependencies in production build.
