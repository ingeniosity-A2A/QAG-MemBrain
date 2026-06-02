# Memory Substrate (Layer 0)

JSONL atomic memory – the single source of truth.

## Subdirectories
- `/jsonl` – Core JSONL schema, read/write utilities, validation.
- `/audit` – Immutable audit logs (every decision with inputs, outputs, reasoning).
- `/learning` – Cortex learning outputs: routing profiles, policy refinements, context models.

## Key Interfaces
- `append(memory: MemoryRecord) -> void`
- `query(filter: QueryFilter) -> AsyncIterable<MemoryRecord>`
- `verify(signature: string) -> boolean`

## Golden Rule
One JSON object = one atomic memory. Never store whole documents.
