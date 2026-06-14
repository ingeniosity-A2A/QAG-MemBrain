# Neo4j Cognitive Graph Specification

## Purpose

This document defines Layer 4 of the QAG_MemBrain Authority Stack.

QAG_MemBrain uses Neo4j GraphRAG as the cognitive retrieval layer.

## Authority Model

Neo4j is authoritative for relationship intelligence, not canonical memory.

Authoritative boundaries:

- JSONL is authoritative for immutable canonical memory.
- Tashi is authoritative for cryptographic verification and lineage consensus.
- GSAP is authoritative for temporal replay and deterministic reconstruction.
- Neo4j is authoritative for relationship intelligence and context assembly.

Neo4j can be rebuilt from JSONL + Tashi + GSAP derived artifacts.

## Neo4j Responsibilities

- Graph traversal across memory, agent, policy, and decision entities
- Vector similarity retrieval
- Relationship analytics and path analysis
- Policy influence chain reconstruction
- Cognitive traversal support for planning/execution context assembly

## Retrieval Flow

```text
JSONL -> Neo4j -> Graph + Vector -> Context Assembly
```

## Data Domains in Graph

- Memory nodes: event, document, conversation, signal
- Agent nodes: reflex, executive, cortex actors
- Policy nodes: threshold, routing, governance artifacts
- Decision nodes: branch points, accepted/rejected outcomes

Relationships include:

- `DERIVES_FROM`
- `INFLUENCED_BY`
- `ROUTED_TO`
- `PRECEDES`
- `ALIGNS_WITH`
- `CONFLICTS_WITH`

## Operational Guidance

Start with Neo4j Community.

Upgrade trigger candidates:

- More than 10M nodes
- Heavy Graph Data Science workloads
- Distributed graph analytics needs
- Large-scale learning loops

## Rebuild Invariant

If graph storage is lost or corrupted, graph state is recomputed from canonical layers.
No canonical memory is accepted from Neo4j writes alone.
