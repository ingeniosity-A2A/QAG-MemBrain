# FORGEDXFILING — unified system identity

**Product / system name:** FORGEDXFILING  
**Git repository / engineering lineage:** `ingeniosity-A2A/Forged-Filing-Sys`  
**Not** a long-lived Git branch of `a2a-exoskeleton`.  
**Not** AppLess-as-foundation.

---

## Entry point (law)

**All processes start at [Forged-Ingestion-Box](FORGED_INGESTION_BOX.md).**

PWA · Agent Browser · Ava console · Bento · ESA skill UIs must emit `ForgedIngestEvent` — never a bare chat message — to begin intake.

---

## Naming table

| Name | Meaning |
|------|---------|
| **FORGEDXFILING** | Unified product/system |
| **Forged-Filing-Sys** | This Git repository |
| **Forged-Ingestion-Box** | Sole multimodal intake surface |
| **FORGEDxFolder** | File/memory exploration surface |
| **Aetheris** | Memory timeline visualization |
| **Bento UI8** | Pluggable UI architecture |
| **Rev.Ike** | Zero-copy streaming substrate |
| **Unified LENS** | Perception layer |
| **A2A-Exoskeleton** | Execution / orchestration boundary |
| **AppLess / OpenUI** | Streamed UI contract reference only |

---

## Architectural placement

```text
EXOSKELETON
│
├── execution (A2A, Agent-X, tools)
├── intelligence interfaces
└── FORGEDXFILING
    ├── Forged-Ingestion-Box   ← START HERE
    ├── Sovereign Ingestion
    ├── Rev.Ike zero-copy
    ├── F0→F3 curation
    ├── Aetheris / FORGEDxFolder
    ├── Bento UI8
    └── Streamed UI contract
```

```text
A2A-Exoskeleton
       │ FORGEDXFILING interface
       ▼
FORGEDXFILING (this repo)
```

### Git layout

```text
ingeniosity-A2A/
├── a2a-exoskeleton
├── Agent-X
├── Forged-Filing-Sys    ← FORGEDXFILING lineage
├── Ava007-Omni-OS       ← hosts Ingestion Box UI on edge/PWA/browser
└── …
```

---

## Canonical pipeline

```text
Forged-Ingestion-Box (text|camera|gallery|document|url|github|hf)
          │ ForgedIngestEvent
          ▼
    UNIFIED LENS / parse
          │
          ▼
       Ava007 context + skill
          │
          ▼
    UI Contract → GSAP → Bento / Aetheris
          │
       USER ACT
          │
          ▼
  A2A-Exoskeleton → result → Ava007 → UI mutates
```

---

## Architecture source PDFs

See [SOURCES_FORGEDXFILING.md](SOURCES_FORGEDXFILING.md).

## Related

- [FORGED_INGESTION_BOX.md](FORGED_INGESTION_BOX.md)  
- [FORGED_FILE_STANDARD.md](FORGED_FILE_STANDARD.md)  
