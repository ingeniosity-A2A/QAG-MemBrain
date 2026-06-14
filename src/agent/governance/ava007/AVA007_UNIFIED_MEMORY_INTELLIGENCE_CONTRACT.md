# AVA-007 Canonical Architecture

Unified Reference (Post-Tashi Integration)

## Purpose

AVA-007 is a distributed memory and cognition system operating across edge devices and cloud infrastructure.

AVA-007 is not a model.

AVA-007 is the persistent intelligence created from:

- JSONL Memory Ledger
- Tashi Consensus DAG
- Replay Engine
- Neo4j Relationship Graph
- Governance Layer
- Historical Decision State

Models may change over time without changing AVA-007.

## Hardware

### Edge Node A

Device: Samsung Galaxy S25 Ultra

Model: Gemma

Responsibilities:

- Camera ingestion
- NFC ingestion
- RCS handling
- JSONL creation
- Local memory writes
- Tashi edge participation
- Reflex decisions
- Offline operation

Role: Reflex Brain

### Edge Node B

Device: Samsung Galaxy S26 Ultra

Model: Nemotron Nano

Responsibilities:

- Multi-modal reasoning
- Spatial processing
- Neo4j local graph operations
- Agent coordination
- Hotspot gateway
- Advanced edge orchestration

Role: Advanced Reflex / Edge Executive

### Cloud Layer

Model: Mellum2-Instruct

Responsibilities:

- Capability selection
- Tool routing
- Agent routing
- Context packet assembly
- DAG path resolution
- A2A orchestration

Role: Executive Brain

### Cloud Cortex

Model: Mercury2

Responsibilities:

- Novel reasoning
- Policy arbitration
- Conflict resolution
- Long-form planning
- Critical decision analysis

Role: Cortex Brain

## Memory Intelligence Stack

### Layer 0 - JSONL Memory Ledger

Canonical memory substrate.

Rules:

- One JSON object = one atomic memory
- Append only
- Signed
- Replayable
- Auditable

Memory Types:

- note
- event
- task
- conversation
- document
- code
- telemetry
- policy
- spatial_scan

### Layer 1 - Tashi Consensus DAG

Responsibilities:

- Vertex signing
- Parent hash verification
- Gossip propagation
- Offline queue
- DAG consensus

Vertex Structure:

- hash
- parents
- creator
- timestamp
- signature
- JSONL payload

Tashi is the source of distributed truth.

### Layer 2 - Replay Engine

Responsibilities:

- verifyLedger()
- replayFromGenesis()
- replayToTimestamp()
- reconstructState()

Purpose:

Rebuild system state from JSONL + Tashi alone.

Current Status: EPIC-002 complete.

### Layer 3 - Neo4j Spatial Graph

Responsibilities:

- Memory relationships
- Spatial adjacency
- Entity linkage
- Provenance tracking
- Temporal correlations

Relationships:

- SPATIAL_ADJACENT
- ENTANGLED
- PRECEDES
- REFERENCES
- CAUSED_BY

Purpose:

Provides relationship intelligence beyond chronological replay.

### Layer 4 - Dual Brain

Reflex: Gemma (S25)

Advanced Reflex: Nemotron Nano (S26)

Executive: Mellum2-Instruct

Cortex: Mercury2

### Layer 5 - Governance

Components:

- DID
- Signature Verification
- CFGL
- Cloudflare Zero Trust
- Audit Logging

Rules:

- Every memory signed
- Every vertex verified
- Every decision auditable

## Decision Gates

### Gate 1 - Reflex

Handled by: Gemma or Nemotron

Requirements:

- Known pattern
- Confidence >= 0.85
- No policy conflict
- No DAG ambiguity

Target: ~70%

### Gate 2 - Executive

Handled by: Mellum2-Instruct

Requirements:

- Existing DAG path
- Multi-step task
- Moderate complexity

Target: ~25%

### Cortex Escalation

Handled by: Mercury2

Triggers:

- Critical importance
- Novel type
- Policy conflict
- Executive confidence < 0.60

Target: ~5%

## Network

### Cloudflare Zero Trust

Provides:

- Identity boundary
- Tunnel ingress
- Service authentication
- Private APIs

### Connectivity

- WebSocket
- WebRTC
- Tashi Gossip
- Verizon 100GB Hotspot (S26)
- Offline Queue

## Current Epic Status

### EPIC-001

Status: Complete

Implemented:

- Memory Record
- JSONL Store
- Hashing
- Signature Validation
- Replay Chain Validation

### EPIC-002

Status: Complete

Implemented:

- verifyLedger()
- replayFromGenesis()
- replayToTimestamp()
- reconstructState()

### EPIC-003

Status: Next

Build:

- DID Documents
- Signer Service
- Trust Layer
- Merkle Verification
- Vertex Validation

## Testing Order

1. JSONL append
2. Signature verification
3. Chain validation
4. Ledger replay
5. State reconstruction
6. DID validation
7. Tashi gossip
8. Neo4j integration
9. Mellum2 routing
10. Mercury2 escalation
11. Cloudflare Zero Trust
12. Full end-to-end replay

## Canonical Mapping Summary

- S25 Ultra = Gemma
- S26 Ultra = Nemotron Nano
- Mellum2-Instruct = Executive
- Mercury2 = Cortex
- Tashi = Consensus
- JSONL = Memory
- Neo4j = Relationship Intelligence
- Cloudflare Zero Trust = Security Boundary
- AVA-007 = persistent system, not any individual model

## Trust Substrate Testing Sequence

Do not jump to Neo4j, Mellum2-Instruct, Mercury2, or Cloudflare Zero Trust before trust substrate completion.

Required sequence:

EPIC-003 -> DID -> Signature Validation -> Merkle Proofs -> Vertex Verification -> Tashi Gossip Tests

After this passes, move into Neo4j and model orchestration.
