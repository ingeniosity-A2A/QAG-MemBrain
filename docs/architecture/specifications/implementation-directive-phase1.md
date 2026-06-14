# QAG_MemBrain Phase 1 Implementation Baseline

## Scope Executed

This baseline implements concrete scaffolding for the authority-stack-first directive.

- No UI surfaces were added.
- JSONL remains canonical memory storage.
- Neo4j is modeled for relationship and vector intelligence only.
- GSAP temporal layer is represented by deterministic replay interfaces.
- Dual Brain and accelerator layers are interface-only at this stage.

## Implemented Artifacts

### Layer 0: JSONL Atomic Memory Ledger

- `memory/atoms/memoryAtom.ts`
  - `MemoryAtom` interface
  - runtime schema guard + assertion
- `memory/ledger/jsonlLedger.ts`
  - `appendAtom()`
  - `readAtom()`
  - `queryAtoms()`
  - `verifyAtom()`
  - append-only enforcement (duplicate id rejection)
  - deterministic hash computation from canonical serialization
- `memory/schemas/memoryAtom.schema.json`
  - JSON Schema artifact for external validation pipelines

### Layer 3: Neo4j Cognitive Graph

- `graph/neo4j/schema/nodeTypes.ts`
  - `Memory`, `Policy`, `Agent`, `Decision`, `Session`, `Document`
- `graph/neo4j/schema/relationshipTypes.ts`
  - `RELATED_TO`, `INFLUENCED_BY`, `GENERATED`, `REFERENCES`, `SUPPORTS`, `CONTRADICTS`
- `graph/neo4j/cypher/001_phase1_authority_stack.cypher`
  - uniqueness constraints for core node labels
  - native vector index definition
- `graph/neo4j/repositories/cognitiveGraphRepository.ts`
  - repository interface
  - in-memory implementation for testability
- `graph/neo4j/graphrag/graphRag.ts`
  - GraphRAG interface + baseline context collector
- `graph/neo4j/vector/vectorIndex.ts`
  - Neo4j vector interface + in-memory cosine similarity stub

### Layer 2: Temporal Truth (GSAP Substrate Interface)

- `temporal/timeline/types.ts`
  - `TimelineEvent`
  - `TimelineSnapshot`
- `temporal/replay/replayEngine.ts`
  - `seek(T)`
  - `reconstructState()`
  - `replayDecision()`
  - `branchReplay()`
  - `auditReplay()`

### Audit Explainability

- `audit/decisions/decisionRecord.ts`
  - `DecisionRecord`
  - append/list audit engine

### Future-Layer Interfaces

- `consensus/tashi/consensus.ts`
  - hash/lineage/consensus interfaces only
- `brain/reflex/runtime.ts`
- `brain/executive/runtime.ts`
- `brain/cortex/runtime.ts`
- `accelerators/fabric.ts`
  - CPU/GPU/NPU/QPU interface-only scaffold

## Tests

- `tests/phase1/authorityStack.e2e.test.ts`
  - validates end-to-end phase-1 path:
    - Store Memory Atom
    - Verify Memory
    - Build Neo4j relationships
    - Replay Timeline
    - Explain Decision
  - validates append-only semantics

## Build and Test

- `package.json` and `tsconfig.json` were added for TypeScript + Vitest execution.
