# QAG_MemBrain Repository Charter

## Mission
QAG_MemBrain is the authoritative memory and cognition architecture for the AVA-007 system. It implements deterministic temporal memory, distributed consensus, and dual-brain orchestration.

## Core Principles
1. Memory is reconstructed, not stored. State is derived from transition laws and temporal coordinates.
2. JSONL is the atomic memory substrate. One line is one immutable, typed, signed memory.
3. Tashi DAG provides leaderless consensus. Vertices are signed JSONL lines, gossiped over WebRTC/WebSocket.
4. GSAP is the temporal orchestration engine. Timelines encode transition functions; easing encodes probability.
5. Dual-brain (Gemma + Mercury 2) executes reflex, executive, and cortex layers.
6. Deterministic replay guarantees auditability. Any state can be reconstructed at any time.
7. Offline-first. Local JSONL and Tashi queue, then sync when connectivity returns.
8. Neo4j is the retrieval database for both graph traversal and vector similarity.

## Cognitive Topology

QAG_MemBrain implements a **dual-consciousness architecture** as defined in `/docs/DUAL_CONSCIOUSNESS_CONTRACT.md`.

| Layer | Component | Role |
|-------|-----------|------|
| **Conscious executor** | AVA-007 | Sole actor: builds, decides, authorizes memory, executes actions |
| **Subconscious interpreter** | REV.IKE | Non-actor: reads memory, generates observations and proposal candidates |
| **Memory** | JSONL Ledger | Immutable, append-only source of truth |
| **Trust** | Tashi DAG + DID | Cryptographic verification of every memory |
| **Replay** | GSAP Timeline | Deterministic state reconstruction |
| **Retrieval** | Neo4j | Graph traversal, vector similarity, and GraphRAG context over memory atoms |
| **Governance** | CFGL + OPA | Policy enforcement and filing decisions |

### Authority Chain (highest to lowest)

1. `AVA007_UNIFIED_MEMORY_INTELLIGENCE_CONTRACT.md`
2. `AVA007_RUNTIME_GOVERNANCE.md`
3. JSONL Ledger
4. Trust Substrate (Tashi, DID)
5. Replay Engine (GSAP)
6. Graph Intelligence (Neo4j)
7. Interpretation Layer (REV.IKE)

Lower layers may not override higher layers.

### Memory Creation Rule

- Only **AVA-007** may append to JSONL.
- REV.IKE may emit `ObservationProposal` objects.
- AVA-007 accepts or rejects each proposal.
- Rejected proposals are discarded (not written to JSONL).

Any code or agent that violates this separation is considered **architectural drift** and will be rejected.

## Architectural Invariant
No subsystem may become a second source of truth.

Canonical ownership:

- JSONL -> Memory
- Replay -> Reconstruction
- Tashi -> Trust
- Neo4j -> Retrieval
- Spatial Cortex -> Meaning
- Temporal Kernel -> Time
- Memory Judge -> Validation

Everything else is derived.

## What Belongs Here
- JSONL schema and management (`/memory`)
- Tashi DAG, gossip, consensus (`/tashi`)
- GSAP timeline serialization and replay (`/temporal`)
- Reflex, executive, cortex processing (`/brain`)
- Neo4j retrieval (graph traversal, vector search, GraphRAG, GDS) (`/retrieval`, `/graph/neo4j`)
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

## Retrieval Contract

Neo4j is the sole active retrieval database.

Responsibilities:

- vector similarity over memory embeddings
- DAG and memory relationship traversal
- GraphRAG context assembly
- GDS jobs for similarity, centrality, and pathfinding

Constraints:

- JSONL remains the source of truth for memory atoms.
- Tashi remains the source of truth for signed DAG lineage.
- Neo4j stores derived query projections and must be rebuildable from JSONL plus Tashi.
- pgvector is retired and must not receive new dual-write flows.

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
- [ ] Neo4j ACID compliance verified for vector index and graph traversal during replay validation.
- [ ] Neo4j retrieval projection rebuilds deterministically from JSONL plus Tashi without pgvector.
