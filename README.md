# QAG_MemBrain

QAG_MemBrain is the authoritative **memory architecture** repository.

It is **memory-first, timeline-first, and audit-first**.

## Repository Charter

QAG_MemBrain implements and maintains:

- Layer 0: JSONL Atomic Memory (canonical memory, immutable event source)
- Layer 1: Tashi DAG (verification, lineage, consensus)
- Layer 2: GSAP Temporal Substrate (temporal replay, state reconstruction)
- Layer 3: Dual Brain (reasoning, planning, execution)
- Layer 4: Neo4j Cognitive Graph (GraphRAG, vector similarity, path and policy analysis)

## Layer Boundaries

QAG_MemBrain separates concerns into clear layers:

1. **Surface Layer (out of scope for this repository)**
   - Customer/developer surfaces, docking station, Opera Air UI, weather/chat modules,
     spatial and sonification canvases.
2. **Runtime Layer (integration boundary, not source of truth)**
   - GSAP/Three.js/audio/spatial/lens/temporal execution systems and agent routing.
3. **QAG_MemBrain Cognition Layer (core of this repository)**
   - Memory ingestion, immutable storage, verification lineage, temporal reconstruction,
     Neo4j GraphRAG context assembly, audit, and learning.

UI implementations are not part of the core architecture and must consume QAG_MemBrain APIs
from separate packages/repositories.

## Retrieval Authority

QAG_MemBrain uses Neo4j GraphRAG as the cognitive retrieval layer.

Neo4j provides:

- Graph traversal
- Vector similarity
- Relationship analysis
- Policy lineage traversal
- Cognitive path reconstruction

Authority boundaries:

- JSONL is authoritative for canonical memory.
- Tashi is authoritative for cryptographic verification and lineage consensus.
- GSAP is authoritative for temporal replay and deterministic reconstruction.
- Neo4j is authoritative for relationship intelligence and context assembly.

Neo4j can be rebuilt. JSONL cannot.

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
├── memory/
│   ├── jsonl/
│   │   └── schemas/
│   └── audit/
├── consensus/
│   └── tashi/
│       ├── signatures/
│       └── lineage/
├── temporal/
│   └── gsap/
│       ├── replay/
│       └── timelines/
├── cortex/
│   ├── executive/
│   ├── reflex/
│   └── learning/
├── graph/
│   └── neo4j/
│       ├── schema/
│       ├── graphrag/
│       ├── vector/
│       ├── cypher/
│       └── gds/
├── output/
│   ├── agents/
│   ├── routing/
│   └── surfaces/
├── docs/
│   └── architecture/
│       ├── charter/
│       ├── migration/
│       └── specifications/
├── interfaces/
│   ├── api/
│   └── sdk/
├── tests/
└── archive/
    └── legacy-references/
```

## Neo4j Edition Guidance

Start with Neo4j Community.

Upgrade trigger candidates:

- Greater than 10M nodes
- Heavy Graph Data Science workloads
- Distributed graph analytics
- Large-scale learning loops

The core simplification is one graph, one vector index, one traversal engine,
and one query language.

```text
JSONL -> Neo4j -> Graph + Vector -> Context Assembly
```

See `docs/architecture/specifications/repository-charter.md` for authoritative charter details.

## Added Context and Neo4j Docs

- `docs/architecture/specifications/neo4j-cognitive-graph.md`
- `docs/architecture/migration/neo4j-authority-stack-migration.md`
- `docs/architecture/context/manual-of-mind-operation-mapping.md`
- `docs/architecture/context/sage-parallels.md`
- `docs/neo4j/README.md`

Uploaded documents preserved verbatim:

- `docs/architecture/charter/repository-charter-uploaded.md`
- `docs/architecture/migration/migration-plan-uploaded.md`
- `docs/specifications/consumption-api-uploaded.md`

Migration note:

Legacy directories such as `brain/`, `retrieval/`, and `tashi/` remain in place for compatibility while new paths under `cortex/`, `graph/neo4j/`, and `consensus/tashi/` are adopted.

Uploaded documents System tools

- using-griptape-with-goose.md
- mpeg-h-audio-processing.md
- cavern-room-correction.md
- using-hf-cli-with-goose.md
