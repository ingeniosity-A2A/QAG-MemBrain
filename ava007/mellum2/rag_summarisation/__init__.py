# RAG Summarisation

Retrieval-augmented generation for assembling memory context before executive decisions.

## Pipeline

1. **Recall** — Neo4j GraphRAG query (vector similarity + DAG traversal)
2. **Rank** — Quantization-aware ranking of retrieved memory chunks
3. **Assemble** — Build complete context packet with causal chain
4. **Summarise** — Compress to fit within Mellum2's ~500 token budget

## GraphRAG Pattern

Single Cypher query combines vector similarity with graph traversal:
```cypher
CALL db.index.vector.queryNodes('memory_embedding', 10, $embedding)
YIELD node AS m, score
MATCH (m)-[:PRECEDES*1..3]->(related:Memory)
WHERE related.importance IN ['high', 'critical']
RETURN m, related, score
ORDER BY score DESC
```
