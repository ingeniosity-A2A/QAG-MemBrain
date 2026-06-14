# /retrieval — Neo4j Graph + Vector Layer

Single database for both graph traversal and semantic similarity.
pgvector is not used. Neo4j handles both concerns natively.

## Why Neo4j replaces pgvector

Standalone vector databases find semantically similar atoms by mathematical proximity.
Neo4j combines vector similarity with graph relationships in a single Cypher query:
find memories that are semantically similar *and* connected to an anchor node
through a defined relationship path.

This maps directly to how QAG_MemBrain reconstructs cognitive state:
traversal follows the Tashi DAG structure; vector search finds relevant atoms
when no temporal coordinate is known. Both queries run in the same environment,
ACID-compliant, with no cross-system consistency problem.

## /neo4j
Schema definitions, migrations, and Cypher query library.

Node types:
- `(:Memory)` — one per JSONL atom, properties mirror the atom schema
- `(:Vertex)` — one per Tashi DAG vertex, holds `vertex_hash` and `parent_hashes`
- `(:Timeline)` — GSAP timeline root, connects to ordered tween atoms
- `(:Policy)` — cortex learning output, connected to the Memory nodes that produced it

Relationship types:
- `(:Memory)-[:PRECEDES]->(:Memory)` — temporal order from Tashi DAG
- `(:Memory)-[:INFLUENCED]->(:Policy)` — audit trail: which memories shaped which policy
- `(:Memory)-[:PART_OF]->(:Timeline)` — which timeline a tween atom belongs to
- `(:Vertex)-[:PARENT_OF]->(:Vertex)` — DAG parent chain for deterministic replay

## /vector
Neo4j vector index configuration and embedding pipeline.

Neo4j vector indexes sit alongside graph indexes in the same database.
Embeddings are stored as a property on `(:Memory)` nodes and indexed via:

```cypher
CREATE VECTOR INDEX memory_embedding IF NOT EXISTS
FOR (m:Memory) ON (m.embedding)
OPTIONS { indexConfig: { `vector.dimensions`: 1536, `vector.similarity_function`: 'cosine' } }
```

Semantic search with graph context (GraphRAG pattern):
```cypher
CALL db.index.vector.queryNodes('memory_embedding', 10, $queryEmbedding)
YIELD node AS m, score
MATCH (m)-[:PRECEDES*1..3]->(related:Memory)
WHERE related.importance IN ['high', 'critical']
RETURN m, related, score
ORDER BY score DESC
```

## /gds
Graph Data Science library queries for cognitive retrieval.

- **Similarity** — find cohorts of related memories across the graph
- **Centrality** (PageRank, Betweenness) — identify the most influential memory nodes
  in a thought chain; used by the cortex learning loop to weight policy updates
- **Pathfinding** (Dijkstra) — find the shortest belief path between two memory nodes;
  used by GSAP temporal layer for timeline reconstruction when DAG gaps exist

## ACID compliance and deterministic replay

Neo4j provides full ACID transactions across both graph writes and vector index updates.
A memory atom is not considered committed until both the graph node and its vector
embedding are indexed within the same transaction. This ensures that `GET /recall`
and vector similarity queries always see a consistent snapshot of the same data.
