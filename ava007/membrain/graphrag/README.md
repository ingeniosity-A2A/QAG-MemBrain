# Layer 3: GQL GraphRAG Retrieval

Part of the **QAG-MemBrain** cognitive runtime in **Ava007**.

## Overview

The GraphRAG layer implements property graph retrieval following **ISO/IEC 39075:2024 GQL** standard concepts. It provides structured, path-constrained graph traversal with LET variable bindings and closed-schema validation — enabling the Ava007 runtime to perform sophisticated knowledge-graph queries over its memory structures.

## Architecture

```
┌──────────────────────────────────────────────────────┐
│              GraphRAGRetrieval (engine)               │
│  ┌─────────────┐ ┌──────────────┐ ┌──────────────┐  │
│  │  query()    │ │ structured_  │ │  hybrid_     │  │
│  │             │ │ retrieve()   │ │  retrieve()  │  │
│  └──────┬──────┘ └──────┬───────┘ └──────┬───────┘  │
│         │               │                │           │
│         ▼               ▼                ▼           │
│  ┌─────────────────────────────────────────────┐     │
│  │        traverse_with_restrictor()           │     │
│  │   WALK │ TRAIL │ ACYCLIC │ SIMPLE           │     │
│  └────────────────────┬────────────────────────┘     │
│                       │                              │
│  ┌────────────┐  ┌────▼─────┐  ┌────────────────┐   │
│  │ Property   │  │  GQL     │  │  Schema        │   │
│  │ Graph      │  │  LET     │  │  Validator     │   │
│  │ (ISO GQL)  │  │  Bindings│  │  (Closed DDL)  │   │
│  └────────────┘  └──────────┘  └────────────────┘   │
└──────────────────────────────────────────────────────┘
```

## Modules

### `property_graph.py` — Property Graph Model

ISO/IEC 39075:2024 compliant property graph with:

- **Nodes** with multiple labels and arbitrary properties
- **Directed edges** with typed relationships and properties
- **Property filtering** with equality and range operators (`gt`, `lt`, `gte`, `lte`, `ne`)
- **Subgraph extraction** by node ID sets
- **Shortest path** via Dijkstra's algorithm
- Label and type indices for fast lookups

```python
from ava007.membrain.graphrag import PropertyGraph

g = PropertyGraph(name="knowledge")
g.add_node("n1", labels=["Concept"], properties={"name": "AI", "score": 0.9})
g.add_node("n2", labels=["Concept"], properties={"name": "ML", "score": 0.8})
g.add_edge("e1", "n1", "n2", type="RELATED_TO", properties={"weight": 0.5})

# Query nodes by label + property filter
high_score = g.query_nodes("Concept", {"score": {"gte": 0.8}})
```

### `path_restrictors.py` — Path Types

Implements the four ISO/IEC 39075:2024 GQL path types:

| Type      | Constraint                                  |
|-----------|---------------------------------------------|
| **WALK**  | No restrictions — nodes/edges may repeat    |
| **TRAIL** | Edges cannot repeat (nodes can)             |
| **ACYCLIC** | Path must be acyclic (no node repeats)    |
| **SIMPLE** | No repeated nodes AND no repeated edges    |

```python
from ava007.membrain.graphrag import traverse_with_restrictor, PathType

paths = traverse_with_restrictor(g, start="n1", path_type=PathType.TRAIL, max_depth=3)
for p in paths:
    print(f"Path: {p.nodes}, Cost: {p.cost}")
```

### `gql_let.py` — LET Variable Bindings

GQL LET variable support for naming intermediate query results:

```python
from ava007.membrain.graphrag import GQLLetBindings

bindings = GQLLetBindings()
bindings.bind("$threshold", 0.8)
bindings.bind("$category", "Concept")

# Resolve with default fallback
threshold = bindings.resolve_or("$threshold", default=0.5)

# Merge two binding scopes
merged = bindings.merge(other_bindings)
```

### `schema_validator.py` — Closed Graph Type DDL

Schema validation enforcing a closed graph type definition:

```python
from ava007.membrain.graphrag import SchemaValidator, NodeTypeSchema, EdgeTypeSchema

validator = SchemaValidator(strict=True)
validator.define_node_type(NodeTypeSchema(
    name="Concept",
    required_properties={"name": str, "score": float},
    optional_properties={"description": str},
    labels=["Concept"],
))
validator.define_edge_type(EdgeTypeSchema(
    name="RELATED_TO",
    source_node_type="Concept",
    target_node_type="Concept",
    required_properties={"weight": float},
))

result = validator.validate_graph(g)
print(f"Valid: {result.valid}, Errors: {result.total_errors}")
```

### `graphrag_retrieval.py` — Retrieval Engine

The core engine tying all components together with three retrieval modes:

1. **`query()`** — Pattern-based traversal with path restrictors
2. **`structured_retrieve()`** — GQL-inspired structured query strings
3. **`hybrid_retrieve()`** — Semantic keyword + structural pattern hybrid

```python
from ava007.membrain.graphrag import GraphRAGRetrieval, QueryPattern, PathType

engine = GraphRAGRetrieval(validator=validator, validate_on_query=True)

# Pattern-based query
pattern = QueryPattern(
    path_type=PathType.TRAIL,
    edge_types=["RELATED_TO"],
    max_depth=4,
    let_bindings={"$threshold": 0.7},
)
result = engine.query(g, start_node="n1", pattern=pattern)

# Structured query
result = engine.structured_retrieve(g, """
    FROM n1
    MATCH TRAIL
    EDGES RELATED_TO
    DEPTH 4
    LET $threshold = 0.7
""")

# Hybrid retrieval
result = engine.hybrid_retrieve(g, "artificial intelligence", top_k=10)
```

## Design Principles

- **ISO/IEC 39075:2024 compliance**: Property graph model, path types, and LET variables follow GQL standard concepts
- **Zero external dependencies**: Pure Python stdlib implementation
- **Composable**: Each component can be used independently or through the retrieval engine
- **Testable**: All methods contain real, working logic — no stubs

## Data Flow

```
Input Query
    │
    ├── Schema Validation (optional pre-check)
    │
    ├── LET Variable Binding Resolution
    │
    ├── Path-Restricted Graph Traversal
    │       │
    │       ├── Edge type filtering
    │       ├── Node label filtering
    │       ├── LET weight bounds ($max_weight, $min_weight)
    │       └── PathType constraint enforcement
    │
    ├── Cost Ranking / Semantic Boosting
    │
    └── QueryResult
            ├── paths: List[GraphPath]
            ├── total_count: int
            ├── execution_time_ms: float
            └── let_variables: Dict[str, Any]
```
