# Retrieval Layer

Retrieval is Neo4j-native. Neo4j owns both graph traversal and vector similarity so semantic recall and relationship context come from one ACID store.

JSONL remains the immutable memory substrate. Tashi remains the signed DAG and trust substrate. Neo4j is the query layer over those atoms and relationships; it is not a second source of truth.

## Ownership

| Path | Responsibility |
|------|----------------|
| `graph/neo4j/schema` | Node and relationship type definitions |
| `graph/neo4j/cypher` | Schema migrations and Cypher query library |
| `graph/neo4j/vector` | Neo4j vector index configuration |
| `graph/neo4j/graphrag` | Combined vector + graph retrieval |
| `graph/neo4j/gds` | Similarity, centrality, and pathfinding jobs |

## Key Operations

- `index(memory)` writes derived Memory nodes and embeddings to Neo4j.
- `retrieveByVector(embedding, k)` uses Neo4j vector indexes.
- `retrieveGraphContext(memoryId, depth)` traverses memory relationships.
- `retrieveGraphRagContext(embedding, k, depth)` combines semantic seeds with graph neighborhoods.

## Canonical GraphRAG Query

```cypher
CALL db.index.vector.queryNodes('memory_embedding_idx', $topK, $embedding)
YIELD node, score
MATCH path = (node)-[:RELATED_TO|INFLUENCED_BY|GENERATED|REFERENCES|SUPPORTS|CONTRADICTS*0..$depth]-(neighbor:Memory)
RETURN
  node.id AS seed_id,
  score,
  collect(DISTINCT neighbor.id) AS context_ids,
  collect(DISTINCT relationships(path)) AS relationship_paths
ORDER BY score DESC
LIMIT $topK;
```

## pgvector Retirement

pgvector is retired from the active architecture. Do not add new pgvector indexes, services, migrations, or dual-write paths.

Neo4j and pgvector may only run side by side during a bounded validation window for migration comparison. After validation, Neo4j is the only retrieval database.
