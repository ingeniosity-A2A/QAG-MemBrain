# QAG_MemBrain — Repository Charter

## Mission

QAG_MemBrain is the **authoritative memory and cognition architecture** for the AVA‑007 system.
It owns deterministic temporal memory, distributed consensus, and dual‑brain orchestration.

It does not own UI. It does not own rendering. It does not own customer surfaces.
Those systems are consumers. This repository is the source.

---

## Core Principles

1. **Memory is reconstructed, not stored.**
   State is derived from transition laws (tween atoms) and temporal coordinates.
   No UI component writes directly to memory. No memory record contains presentation logic.

2. **JSONL is the atomic memory substrate.**
   One line = one immutable, typed, signed memory record.
   Documents, conversations, sensor events, and agent decisions all reduce to atoms.

3. **Tashi DAG provides leaderless consensus.**
   Vertices are signed JSONL lines gossiped over WebRTC/WebSocket.
   No central coordinator. Offline queue flushes on reconnect.

4. **GSAP is the temporal orchestration engine.**
   Timelines encode transition functions. Easing = probability.
   GSAP inside this repository touches only state objects — never the DOM.

5. **Dual‑brain executes reflex, executive, and cortex layers.**
   Reflex (on‑device, Nemotron/Gemma) → Executive (Mellum2) → Cortex (Mercury 2 / Ava007).
   Escalation is determined by confidence threshold and importance rating, not by content type.

6. **Deterministic replay guarantees auditability.**
   Same timeline definition + same start time → identical state at any `t`.
   This is a hard invariant. Any change that breaks replay is a breaking change.

7. **Offline‑first.**
   Local JSONL + Tashi queue operates without connectivity.
   Sync occurs when the mesh reconnects. No data is lost.

---

## What Belongs Here

| Directory | Content |
|-----------|---------|
| `/memory` | JSONL schema, read/write, audit logs, learning outputs |
| `/tashi` | DAG vertex structure, gossip transport, consensus logic |
| `/temporal` | GSAP timeline serialization, tween atoms, replay engine |
| `/brain` | Reflex, executive, cortex processing and escalation gates |
| `/retrieval` | Neo4j graph + vector indexes, GDS embeddings, GraphRAG queries |
| `/interfaces` | REST + WebSocket API, TypeScript + Python SDKs |
| `/tests` | Deterministic replay, offline sync, API contract suites |
| `/docs` | Architecture diagrams, specifications, API contracts |
| `/archive` | Read‑only legacy references — no active development |

---

## What Does NOT Belong Here

- UI components of any kind (chat, weather, docking station, spatial canvas)
- Three.js scene setup, WebGL, audio rendering, sonification
- Customer-facing application code or developer consoles
- Runtime engine configuration (6D engine, lens, Opera Air UI)
- Presentation logic of any kind
- Experiments unrelated to memory or cognition

If a file renders pixels or plays sound, it does not belong in this repository.

---

## Repository Relationships

| Repository | Role | Consumes QAG_MemBrain via |
|------------|------|---------------------------|
| `ava-surface` | Customer UI and developer surfaces | `/interfaces/api` REST + WS |
| `ava-runtime` | 6D engine, Three.js, audio, lens | `/interfaces/api` for temporal state |
| Legacy repos | Read‑only archives | No active dependency |

Surface packages are consumers. They call the API. They do not fork this repository
to add UI features — they build their own layer on top of the interfaces defined here.

---

## Governance Rules

- All changes must maintain deterministic replay. Tests must pass before merge.
- Every memory mutation must be signed (Ed25519 / DID) and appended to JSONL.
- Tashi vertices must reference parent hashes. Orphaned vertices are rejected.
- No UI code shall be merged into any directory outside `/archive`.
- API versioning follows semantic versioning. Breaking changes increment the major version.
- The `/archive` directory is read‑only. No new code is added there.

---

## Success Criteria

- [ ] Deterministic replay: same timeline + start time → identical state
- [ ] Offline sync: Tashi queue flushes correctly on mesh reconnect
- [ ] Ed25519 signatures verified on every vertex
- [ ] Audit log captures all inputs, outputs, brain tier used, and latency
- [ ] Zero UI or DOM dependencies in production build
- [ ] Surface packages (`ava-surface`) build and run against this API without forking
- [ ] Neo4j ACID compliance verified: vector index + graph traversal return identical results on replay
