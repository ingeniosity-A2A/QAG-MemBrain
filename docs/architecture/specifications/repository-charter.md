# QAG_MemBrain Repository Charter

## Purpose

QAG_MemBrain is the authoritative memory architecture repository.

Legacy repositories are archival references only.

This repository is the source of truth for cognition and memory continuity,
not presentation systems.

## Authoritative Architecture

QAG_MemBrain maintains the following architecture stack:

- Layer 0: JSONL Atomic Memory (canonical record, immutable event source)
- Layer 1: Tashi DAG (verification, lineage, consensus, cryptographic truth)
- Layer 2: GSAP Temporal Substrate (temporal truth, replay truth, state reconstruction)
- Layer 3: Dual Brain (reasoning, planning, execution)
- Layer 4: Neo4j Cognitive Graph (relationship truth, GraphRAG, vector similarity, path analysis, policy influence chains)

### Authority Boundaries

QAG_MemBrain uses Neo4j GraphRAG as the cognitive retrieval layer.

Neo4j owns relationship intelligence:

- Semantic similarity
- Memory relationships
- Agent relationships
- Policy relationships
- Decision chains
- Cognitive traversals
- Graph analytics

Authoritative boundaries remain explicit:

- JSONL remains authoritative for canonical memory.
- Tashi remains authoritative for verification and lineage consensus.
- GSAP remains authoritative for temporal replay and deterministic reconstruction.
- Neo4j remains authoritative for relationship intelligence and context assembly.

Neo4j can be rebuilt from authoritative layers. JSONL cannot.

### Core Principle 01

Facts are immutable.

Relationships are mutable.

Meaning:

- JSONL remains immutable canonical memory.
- Neo4j remains rebuildable relationship structure.
- Tashi, GSAP, and audit layers protect how facts are verified, replayed, and traced.

This boundary prevents graph corruption from becoming memory corruption.

## Concern Separation

### Surface Layer (Presentation)

Examples include customer/developer surfaces, docking station interfaces,
Opera Air UI, weather/chat modules, spatial canvases, and sonification canvases.

These systems are presentation concerns and are out of scope for this core repository.

### Runtime Layer (Execution)

Examples include GSAP, Three.js, audio/spatial/lens/temporal engines,
and agent routing execution components.

These systems are runtime execution concerns and do not redefine memory architecture.

Neo4j is not treated as a surface/runtime concern in this model. It is a cognition-layer substrate for GraphRAG retrieval and relationship traversal.

### QAG_MemBrain Layer (Cognition)

This repository owns cognition concerns:

- Input handling
- Immutable JSONL memory
- DAG-backed consensus progression
- Temporal timeline substrate
- Dual-brain processing
- Neo4j-backed graph and vector context assembly
- Output generation
- Audit trail generation
- Learning feedback integration

## Repository Goals

1. Deterministic replay
2. Memory immutability
3. Cryptographic verification
4. Offline-first synchronization
5. Temporal reconstruction
6. Auditability
7. Long-term cognitive continuity

## Integration Policy

External technologies may be evaluated for compatibility but must not redefine
the architecture.

UI and surface implementations must be provided as separate packages/repositories
consuming QAG_MemBrain APIs.

## Neo4j Edition Guidance

Start with Neo4j Community.

Upgrade to Neo4j Enterprise when one or more apply:

- Greater than 10M nodes
- Heavy Graph Data Science workloads
- Distributed graph analytics requirements
- Large-scale learning loop workloads
