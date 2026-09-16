# Consolidation Intake — QAG-MemBrain

**Receiving from:**

1. **Core-Membrain** (full merge)
   - `memory/`, `graph_rag/`, `context_lake/`, `sql/`, Docker, Cargo/Rust core
   - Target layout: `memory/core-membrain/` or keep as top-level modules with clear ownership notes

2. **Ava007** (memory / analytical remainder only)
   - DuckDB / Quack service, Core-Membrain server fallbacks, observability memory pieces
   - Intellect/Core-Q² material stays in Cybernetic-Ava007

**After verification:** delete empty `Core-Membrain` and (after full Ava007 split) `Ava007`.

## Hierarchy reminder

```text
Cybernetic-Ava007 > a2a-exoskeleton (forged-ai-filing-os | fapo-ran) > Ava007-Omni-OS > Agent-X
QAG-MemBrain = persistent memory authority
```

See also `CONSOLIDATION_MANIFEST.md` already in this repo.
