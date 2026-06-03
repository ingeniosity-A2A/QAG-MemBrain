# Vector Retrieval and Embeddings

Semantic search over JSONL memory using pgvector.

## Subdirectories
- /pgvector: Schema, migrations, query layer
- /embeddings: Embedding generation and caching

## Key Operations
- index(memory: MemoryRecord): void
- search(query: string, k: number): MemoryRecord[]

## Integration
Embeddings are metadata helpers for recall when temporal coordinate is unknown. They are not a source of truth.
