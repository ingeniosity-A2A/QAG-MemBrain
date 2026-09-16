# Core-Membrain (absorbed into QAG-MemBrain)

**Status:** Consolidated 2026-09-16 from `ingeniosity-A2A/Core-Membrain`.

**Role:** Memory membrane for Cybernetic Ava007 (Core-Q²).  
**Not:** A second Intellect. Not a peer mind. Not a chat agent.

## What this module owns

| Concern | Original Path |
|---------|---------------|
| Atomic memory (JSONL / Interaction Quanta) | `memory/jsonl/` |
| Tashi / DAG consensus + lineage | `memory/tashi/` |
| Temporal / GSAP memory hooks | `memory/temporal/` |
| Graph RAG | `graph_rag/` |
| Context Lake / Ocean | `context_lake/` |
| Lite Notebook (INJECT path) | `lite_notebook/` |
| Schema evolution | `src/core/schema_evolution/` |
| Dam architecture | `src/core/dam/` |
| CFGL filing | `src/core/cfgl/` |
| Ingestion pipeline | `src/core/ingestion/` |
| Config | `config/` |
| SQL schemas | `sql/`, `migrations/` |

## Architecture

```
Input → Ingestion → CFGL → Dam → Context Lake → Lite Notebook → INJECT
                  ↑
         Schema Evolution (drift detection + convergence)
```

## Package identity (from original Cargo.toml)

- Package name: `ingenosity-core` v3.0.0
- Binary: `ingenosity`
- Lib: `ingenosity_core`

## Rules (from original AGENTS.md)

- Deposit path = INJECT (atomic JSON / Interaction Quantum).
- Off-prompt dark matter stays out of LLM context.
- No "Ava lives here" or dual-brain language.
- Export clear APIs: deposit, recall, lineage — not chat agents.
- Edge = Galaxy S26 Ultra only.
- Prefer INJECT over BUILD. Do not invent a second Core-Q².

## Source history

Full source remains in the archived `Core-Membrain` repo until that repository is deleted.  
Clone/subtree the original if you need the complete Rust tree, Docker, and migrations.

Canonical hierarchy: see `a2a-exoskeleton/CONSOLIDATION.md`.
