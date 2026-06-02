# Vector Retrieval & Embeddings

Semantic search over JSONL memory using pgvector.

## Subdirectories
- `/pgvector` – PostgreSQL + pgvector schema, migrations, queries.
- `/embeddings` – Embedding generation (ONNX Runtime Web or cloud model), caching.

## Key Operations
- `index(memory: MemoryRecord) -> void` – Create embedding and store.
- `search(query: string, k: number) -> MemoryRecord[]` – Similarity search.

## Integration with GSAP
Embeddings are stored in JSONL metadata (`embedding` field) and can be used for semantic recall when temporal coordinate is unknown.
