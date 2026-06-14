# Quantum Atomic GSAP Membrain Framework

**8-Layer Cognitive Memory Architecture for Ava007 Edge Nodes**

This framework implements the full QAG-MemBrain stack: from ion-memory filament emulation through GSAP temporal synchronization to S25 Ultra hardware unlocking. Each layer is independently testable and wires into the existing `src/` TypeScript runtime via well-defined bridges.

## Layer Architecture

| Layer | Module | Responsibility |
|-------|--------|---------------|
| L1 | `ion_memory/` | Ion memory emulation — filament state store, MLC 8-level conductance, endurance tracking, L1/L2/L3 persistence tiers, epoch snapshots |
| L2 | `fast_mesh/` | Free API Storage Mesh — SHA-256 content-addressable dedup, cache tiers (in-proc/R2/IPFS), token-bucket rate governance, graph-to-mesh serialization |
| L3 | `graphrag/` | GQL GraphRAG Retrieval — ISO/IEC 39075:2024 property graph model, path restrictors (WALK/TRAIL/ACYCLIC/SIMPLE), LET variable support, closed Graph Type DDL |
| L4 | `reinforcement/` | GRPO/DAPO Reinforcement Learning — group-normalized reward scoring, asymmetric epsilon clipping, per-token loss normalization with length bias fix, verifiable reward functions |
| L5 | `gsap_temporal/` | GSAP Temporal Synchronization — deterministic lifecycle management, cognitive epoch visualization, superposition observation/collapse |
| L6 | `dualbrain/` | DualBrain Inference Router — confidence-threshold routing (Graph/Prompt/Hybrid), factual query detection and augmentation |
| L7 | `pipeline/` | Pipeline Orchestration — end-to-end query flow, memory writeback to ion store, response generation |
| L8 | `hardware/` | S25 Ultra Hardware Unlock — Tier 1 (QNN+GPU+Wi-Fi Direct), Tier 2 (CPU pinning+tmpfs), Tier 3 (ionmemd daemon+UFS mmap) |

## Wiring to Existing Runtime

The Python layers (L1-L4, L6-L8) bridge to the TypeScript runtime via:

- **`src/memory/jsonl/`** — L1 persistence backend uses JSONL for audit trail
- **`src/memory/graph/neo4j/`** — L3 GraphRAG queries the same graph store
- **`src/agent/ava007/`** — L6 dualbrain router integrates with Ava007Orchestrator
- **`src/memory/temporal/`** — L5 GSAP temporal sync wraps GSAPTemporalReconstructor
- **`src/agent/cortex/`** — L7 pipeline feeds into reflex/executive/cortex tiers

## Running Tests

```bash
cd ava007/membrain
python -m pytest ion_memory/ fast_mesh/ graphrag/ reinforcement/ dualbrain/ pipeline/ hardware/ -v
```

## Quick Start

```python
from ion_memory.ion_memory import IonMemoryStore
from fast_mesh.fast_mesh import FAStMesh
from graphrag.graphrag_retrieval import GraphRAGRetrieval
from dualbrain.dualbrain_router import DualBrainRouter
from pipeline.pipeline import MembrainPipeline

# Initialize the full stack
store = IonMemoryStore()
mesh = FAStMesh()
retrieval = GraphRAGRetrieval()
router = DualBrainRouter()
pipeline = MembrainPipeline(store=store, mesh=mesh, retrieval=retrieval, router=router)

# Process a query through the full 8-layer stack
result = pipeline.execute("Tactical query about stalled deployment")
```
