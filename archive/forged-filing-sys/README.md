# Forged-Filing-Sys

**Product identity:** **FORGEDXFILING**  
**Git lineage:** Forged-Filing-Sys (this repo)  
**Formerly:** Forged-AI-Filing-OS / Forged-Filing-Sys rename path

> Full architecture: [`docs/FORGEDXFILING.md`](docs/FORGEDXFILING.md)  
> Filing contract: [`docs/FORGED_FILE_STANDARD.md`](docs/FORGED_FILE_STANDARD.md)  
> SPARC + turbovec intelligence layer: [`docs/SPARC_TURBOVEC_ARCHITECTURE.md`](docs/SPARC_TURBOVEC_ARCHITECTURE.md) · [entry points](docs/ENTRY_POINTS.md) · [SemanticExplorer](components/bento/SemanticExplorer.tsx)

## What this is

FORGEDXFILING is the **unified filing / memory / ingestion / exploration subsystem**:

- Sovereign ingestion  
- Rev.Ike zero-copy streaming  
- F0→F3 curation & provenance  
- Aetheris memory timeline  
- FORGEDxFolder exploration  
- Bento UI8 + GSAP Kernel  
- Streamed UI contract (OpenUI/AppLess-compatible **reference**, not foundation)

It is a **major subsystem under the Exoskeleton framework**, not an ordinary feature branch of `a2a-exoskeleton`, and not a replacement for Ava007 intellect.

## Authority (locked)

| System | Owns | Does NOT own |
|--------|------|----------------|
| **Cybernetic-Ava007** | Intelligence, skills, reasoning | Filing implementation, edge OS |
| **FORGEDXFILING / Forged-Filing-Sys** | Ingest, stream, curate, remember, visualize | Cognitive authority, A2A execution |
| **a2a-exoskeleton** | Orchestration, execution gateway, skill runtime | Absorbing FORGEDXFILING internals |
| **Agent-X** | Execution adapters | Intelligence authority |
| **Ava007-Omni-OS** | Edge, browser-engine, Unified LENS runtime | Second filing authority |

```text
CYBERNETIC-AVA007     → understands
FORGEDXFILING         → records, streams, visualizes intelligence
A2A-EXOSKELETON       → orchestrates / executes (via FORGEDXFILING interface)
AGENT-X               → exposes capabilities
OMNI-OS               → environments (S26, LENS, radio)
```

## Git layout

```text
ingeniosity-A2A/
├── a2a-exoskeleton
├── Agent-X
├── Forged-Filing-Sys     ← this repo = FORGEDXFILING lineage
├── Ava007-Omni-OS
└── …
```

Integration limb may still exist at `a2a-exoskeleton/forged/`; product docs and identity stay here.

## Status

Forged File Standard **v1.2.0** · Three colors: neutral / orange / yellow  
Architecture sources: [`docs/SOURCES_FORGEDXFILING.md`](docs/SOURCES_FORGEDXFILING.md)

## Quick start

```bash
python -m forged_ai_filing_os.main init
python -m forged_ai_filing_os.main forge path/to/doc.md --domain municipal_council
python -m forged_ai_filing_os.main manifest
python -m forged_ai_filing_os.main validate
```

Owner: **ingeniosity-A2A · Ava007**
