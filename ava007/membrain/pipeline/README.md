# QAG-MemBrain Pipeline Layer (L7: PIPELINE ORCHESTRATION)

Orchestrates the end-to-end query flow through all MemBrain layers: from query ingestion through routing, retrieval, augmentation, writeback, and response generation.

## Architecture

```
Query ──► MembrainPipeline.execute()
              │
              ├─ 1. Cache check (FAStMesh)
              ├─ 2. Route via DualBrainRouter ──► GRAPH / PROMPT / HYBRID
              ├─ 3. GRAPH  ──► GraphRAG retrieval (L3)
              ├─ 4. PROMPT ──► Template generation (L5 Mellum2)
              ├─ 5. HYBRID ──► Both + merge
              ├─ 6. Response generation (citations, confidence)
              ├─ 7. Writeback to ion store (L1, tiered)
              ├─ 8. Cache in FAStMesh (L2)
              └─ 9. Return PipelineResult
```

## Modules

| Module | Class | Responsibility |
|--------|-------|---------------|
| `pipeline.py` | `MembrainPipeline` | Core pipeline wiring all layers; execute / execute_batch / get_stats |
| `orchestration.py` | `QueryOrchestrator` | End-to-end query flow with stage tracking, cancel, retry-from-failure |
| `writeback.py` | `MemoryWriteback` | Memory → ion store writeback with SHA-256 hashing and tiered storage |
| `response_generator.py` | `ResponseGenerator` | Structured response generation with citations and merge strategies |

## Data Structures

### PipelineResult
```python
PipelineResult(
    query="What is the deployment status?",
    answer="[GraphRAG] Retrieved results...",
    mode="graph",           # graph | prompt | hybrid
    confidence=0.72,
    latency_ms=12.5,
    layers_used=["pipeline", "dualbrain", "graphrag", ...],
    metadata={...}
)
```

### OrchestrationResult
```python
OrchestrationResult(
    query_id="uuid-...",
    stages=[StageResult(...), ...],   # ingest→route→retrieve→...→respond
    final_result={...},
    total_duration_ms=45.2,
    success=True
)
```

### WritebackRecord
```python
WritebackRecord(
    id="uuid-...",
    query="What is X?",
    result_hash="sha256-hex...",
    tier="L1",                # L1 (>0.8) | L2 (0.5-0.8) | L3 (<0.5)
    timestamp="2025-01-01T00:00:00Z",
    verified=False
)
```

### GeneratedResponse
```python
GeneratedResponse(
    answer="...",
    confidence=0.72,
    citations=[Citation(source_id, source_type, relevance, excerpt)],
    mode="graph",
    metadata={"generation_time_ms": 3.2}
)
```

## Quick Start

### Basic Pipeline
```python
from ava007.membrain.pipeline import MembrainPipeline

pipeline = MembrainPipeline()
result = pipeline.execute("What is the deployment status of cluster-7?")
print(result.answer, result.mode, result.confidence)
```

### With Dependency Injection
```python
from ava007.membrain.ion_memory import IonMemoryStore
from ava007.membrain.fast_mesh import FAStMesh
from ava007.membrain.graphrag import GraphRAGRetrieval
from ava007.membrain.pipeline import MembrainPipeline

store = IonMemoryStore()
mesh = FAStMesh()
retrieval = GraphRAGRetrieval()
pipeline = MembrainPipeline(store=store, mesh=mesh, retrieval=retrieval)
```

### Orchestration with Stage Tracking
```python
from ava007.membrain.pipeline import QueryOrchestrator

def ingest_handler(query, ctx, prev):
    return {"query": query, "ingested_at": time.time()}

def route_handler(query, ctx, prev):
    return {"mode": "graph", "confidence": 0.8}

orchestrator = QueryOrchestrator(
    stage_handlers={"ingest": ingest_handler, "route": route_handler}
)
result = orchestrator.orchestrate("What is X?")
```

### Writeback with Verification
```python
from ava007.membrain.pipeline import MemoryWriteback

wb = MemoryWriteback()
record = wb.writeback({"query": "test", "confidence": 0.9, "answer": "Yes"})
verified = wb.verify_writeback(record.id)  # True if data persists
```

### Response Generation with Merge Strategies
```python
from ava007.membrain.pipeline import ResponseGenerator

gen = ResponseGenerator(graph_weight=0.6, prompt_weight=0.4)

# Merge with contradiction checking
merged = gen.merge_results(
    graph_answer="X is true.",
    prompt_answer="X is not true.",
    strategy="contradiction_check"
)
```

## Tier Selection

Writeback tier is determined by confidence:

| Tier | Confidence | Description |
|------|-----------|-------------|
| L1 | > 0.8 | Hot — frequently accessed, fast retrieval |
| L2 | 0.5 – 0.8 | Warm — standard storage |
| L3 | < 0.5 | Cold — archive, slow retrieval |

## Merge Strategies

| Strategy | Behavior |
|----------|----------|
| `graph_priority` | Use graph answer if available, augment with prompt context |
| `prompt_priority` | Use prompt answer, augment with graph context |
| `weighted` | Combine with configurable graph/prompt weights |
| `contradiction_check` | Flag negation conflicts between graph and prompt |

## Running Tests

```bash
cd ava007/membrain
python -m pytest pipeline/ -v
```
