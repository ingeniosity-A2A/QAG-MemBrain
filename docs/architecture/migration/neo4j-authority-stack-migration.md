# Neo4j Authority Stack Migration

## Objective

Physically align repository layout and architecture docs to the QAG_MemBrain Authority Stack.

## Status

Implemented in this repository update:

- Added canonical target directories for `consensus`, `cortex`, `graph`, and `output`.
- Added Neo4j architecture documentation and context mappings.
- Preserved legacy directories (`brain`, `retrieval`, `tashi`) for safe transition.

## Physical Directory Targets

```text
memory/jsonl/schemas/
consensus/tashi/signatures/
consensus/tashi/lineage/
temporal/gsap/replay/
temporal/gsap/timelines/
cortex/executive/
cortex/reflex/
cortex/learning/
graph/neo4j/schema/
graph/neo4j/graphrag/
graph/neo4j/vector/
graph/neo4j/cypher/
graph/neo4j/gds/
output/agents/
output/routing/
output/surfaces/
```

## Compatibility Rules

- Keep legacy paths available during migration windows.
- Prefer new paths for all new work.
- Use adapters/symlinks only if build tooling requires legacy imports.

## Migration Sequence

1. Move graph and retrieval logic from `retrieval/*` to `graph/neo4j/*`.
2. Move brain-tier logic from `brain/*` to `cortex/*`.
3. Move consensus artifacts from `tashi/*` to `consensus/tashi/*`.
4. Keep deterministic replay and signature tests green at each step.
5. Remove legacy paths only after two release cycles with no dependency hits.

## Validation Checklist

- Deterministic replay tests pass.
- Vertex signature/lineage verification passes.
- Graph rebuild pipeline completes from canonical layers.
- API retrieval produces equivalent or better recall fidelity.

## Definition of Done

- New architecture paths are the default in docs and code imports.
- Neo4j GraphRAG is the active retrieval engine.
- Canonical authority boundaries remain unchanged.
