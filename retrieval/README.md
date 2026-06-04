# Retrieval Layer (Neo4j Unified Graph + Vector)

Retrieval is Neo4j-native.

The retrieval layer no longer uses pgvector. Neo4j now owns both:

- relationship traversal across memory atoms
- vector similarity for semantic recall

This keeps graph traversal and nearest-neighbor retrieval in one ACID store and avoids dual-write drift.

## Subdirectories

- /neo4j: schema, node types, relationship types, Cypher query library
- /vector: vector index configuration and GraphRAG query patterns
- /gds: graph data science jobs (similarity, centrality, pathfinding)

## Key Operations

- index(memory: MemoryRecord): void
- retrieveByTheme(theme: string, k: number): MemoryRecord[]
- retrieveByVector(embedding: number[], k: number): MemoryRecord[]
- retrieveGraphContext(memoryId: string, depth: number): MemoryRecord[]

## Canonical GraphRAG Pattern

Use one query to combine semantic lookup with graph traversal:

```cypher
CALL db.index.vector.queryNodes('memory_embedding_idx', $topK, $embedding)
YIELD node, score
MATCH (node)-[:RELATED_TO|FOLLOWS_TEMPORALLY*1..2]-(neighbor:Memory)
RETURN node.id AS seed_id,
       score,
       collect(distinct neighbor.id) AS context_ids
ORDER BY score DESC
LIMIT $topK;
```

## Integration

Retrieval remains advisory. JSONL and Tashi remain authoritative memory and trust substrates.

## Deprecation Notice

The pgvector path is retired from active architecture. Do not introduce new dual-write retrieval flows.
