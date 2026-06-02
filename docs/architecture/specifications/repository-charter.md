# QAG_MemBrain Repository Charter

## Purpose

QAG_MemBrain is the authoritative memory architecture repository.

Legacy repositories are archival references only.

This repository is the source of truth for cognition and memory continuity,
not presentation systems.

## Authoritative Architecture

QAG_MemBrain maintains the following architecture stack:

- Layer 0: JSONL Atomic Memory
- Layer 1: Tashi DAG Consensus
- Layer 2: GSAP Temporal Substrate
- Layer 3: Dual Brain Processing
- Output Layer
- Audit Layer
- Learning Layer

## Concern Separation

### Surface Layer (Presentation)

Examples include customer/developer surfaces, docking station interfaces,
Opera Air UI, weather/chat modules, spatial canvases, and sonification canvases.

These systems are presentation concerns and are out of scope for this core repository.

### Runtime Layer (Execution)

Examples include GSAP, Three.js, audio/spatial/lens/temporal engines,
and agent routing execution components.

These systems are runtime execution concerns and do not redefine memory architecture.

### QAG_MemBrain Layer (Cognition)

This repository owns cognition concerns:

- Input handling
- Immutable JSONL memory
- DAG-backed consensus progression
- Temporal timeline substrate
- Dual-brain processing
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
