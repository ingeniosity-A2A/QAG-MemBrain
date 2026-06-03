# Memory Substrate (Layer 0)

JSONL atomic memory is the single source of truth.

## Subdirectories
- /jsonl: Core JSONL schema, read/write utilities, validation
- /audit: Immutable audit logs (inputs, outputs, reasoning)
- /learning: Cortex learning outputs (routing profiles, policy refinements, context models)

## Key Interfaces
- append(memory: MemoryRecord): void
- query(filter: QueryFilter): AsyncIterable<MemoryRecord>
- verify(signature: string): boolean

## Golden Rule
One JSON object equals one atomic memory. Never store whole documents as memory truth.
