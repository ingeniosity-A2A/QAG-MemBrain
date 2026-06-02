# QAG_MemBrain

QAG_MemBrain is the authoritative **memory architecture** repository.

It is **memory-first, timeline-first, and audit-first**.

## Repository Charter

QAG_MemBrain implements and maintains:

- Layer 0: JSONL Atomic Memory
- Layer 1: Tashi DAG Consensus
- Layer 2: GSAP Temporal Substrate
- Layer 3: Dual Brain Processing
- Output Layer
- Audit Layer
- Learning Layer

## Layer Boundaries

QAG_MemBrain separates concerns into clear layers:

1. **Surface Layer (out of scope for this repository)**
   - Customer/developer surfaces, docking station, Opera Air UI, weather/chat modules,
     spatial and sonification canvases.
2. **Runtime Layer (integration boundary, not source of truth)**
   - GSAP/Three.js/audio/spatial/lens/temporal execution systems and agent routing.
3. **QAG_MemBrain Cognition Layer (core of this repository)**
   - Memory ingestion, immutable storage, temporal reconstruction, audit, and learning.

UI implementations are not part of the core architecture and must consume QAG_MemBrain APIs
from separate packages/repositories.

## Architecture Goals

1. Deterministic replay
2. Memory immutability
3. Cryptographic verification
4. Offline-first synchronization
5. Temporal reconstruction
6. Auditability
7. Long-term cognitive continuity

## Repository Structure

```text
QAG_MemBrain/
├── docs/
│   └── architecture/
│       └── specifications/
├── memory/
│   ├── jsonl/
│   ├── audit/
│   └── learning/
├── tashi/
│   ├── dag/
│   ├── gossip/
│   └── consensus/
├── temporal/
│   ├── gsap/
│   ├── timeline/
│   └── serialization/
├── brain/
│   ├── reflex/
│   ├── executive/
│   └── cortex/
├── retrieval/
│   ├── pgvector/
│   └── embeddings/
├── interfaces/
│   ├── api/
│   └── sdk/
├── tests/
└── archive/
    └── legacy-references/
```

See `docs/architecture/specifications/repository-charter.md` for the authoritative charter details.
