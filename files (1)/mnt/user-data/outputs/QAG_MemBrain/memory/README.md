# /memory — Atomic Memory Substrate (Layer 0)

Single source of truth. Every input becomes a signed JSONL atom here.

**Golden rule:** One JSON object = one atomic memory. Never store a whole document as one record.

## /jsonl
Schema (`schema.ts`), read/write utilities (`io.ts`, `io.py`), SHA-256 fingerprinting,
Ed25519 signing (`signing.ts`).

## /audit
Immutable audit log. Every Dual Brain decision is written here with:
`brain_tier`, `model_used`, `latency_ms`, `inputs`, `outputs`, `reasoning`.
Audit records are themselves JSONL atoms — they go through the same signing pipeline.

## /learning
Cortex outputs: updated routing policies, confidence threshold adjustments,
new known-type entries for the reflex gate config. Written after the cortex
reads telemetry from the audit log.

## Key interfaces
```typescript
append(memory: MemoryRecord): Promise<{ id: string; vertex_hash: string }>
query(filter: QueryFilter): AsyncIterable<MemoryRecord>
verify(atom: MemoryRecord): boolean
```
