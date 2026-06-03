# Memory Intelligence Model

This is the governing architecture model for ownership boundaries.

JSONL = Memory

Replay = Reconstruction Data

Tashi = Trust

DID = Provenance

Spatial Cortex = Meaning

Neo4j = Relationship Projection

Temporal Kernel = Time

GSAP = Execution

Memory Judge = Validation

API = Consumption

## Canonical Ownership Rule
No subsystem may become a second source of truth.

Canonical ownership:

- JSONL -> Memory
- Replay -> Reconstruction
- Tashi -> Trust
- Spatial Cortex -> Meaning
- Temporal Kernel -> Time
- Memory Judge -> Validation

Everything else is derived.

## Replay Ownership
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

## EPIC-001
Establish Canonical Ownership and enforce this model across all subsystem docs and runtime integrations.
