# /retrieval — Vector Retrieval and Embeddings

Semantic search over JSONL atoms when temporal coordinates are unknown.

## /pgvector
PostgreSQL + pgvector schema, migrations, and query utilities.
The `embedding` field in each JSONL atom is indexed here at ingestion.

## /embeddings
Embedding generation (ONNX Runtime or cloud model call).
Results cached in `metadata.embedding` — never regenerated if hash is unchanged.

## Key operations
```typescript
index(memory: MemoryRecord): Promise<void>
search(query: string, k: number): Promise<MemoryRecord[]>
```

## Integration with GSAP
When `GET /recall` has no temporal coordinate, retrieval finds k-nearest atoms
by semantic similarity and passes them to GSAP for timeline reconstruction.
Fidelity will be lower than time-based recall.
