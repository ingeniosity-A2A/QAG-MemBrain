# Tekton Core → SPARC Mapping — Ava007 Curation Workstation

**Status:** Merger complete 2026-09-16. Renamed **Void → Tekton Core** 2026-09-17.
**Canonical home:** [`a2a-exoskeleton/tekton-core/`](https://github.com/ingeniosity-A2A/a2a-exoskeleton/tree/main/tekton-core)

The workstation is built on **Void** — a VS Code fork (Electron + Monaco + custom React 19 UI) that functions as an open-source AI code editor ([`voideditor/void`](https://github.com/voideditor/void)).  
Licensed Apache 2.0 (Void additions) / MIT (VS Code base).  
Upstream development paused / archived; source remains the preferred reference base. The Ava007 adaptation is named **Tekton Core**.

Critical property: **no middleman backend** — prompts go directly to providers (or local Ollama / vLLM / LM Studio).

---

## Layer Mapping

| SPARC Layer | Tekton Core Feature | Output Path |
|-------------|--------------|-------------|
| **Intake** | Direct provider access + local models + provenance | `/intake/raw/`, `/intake/parsed/`, `sources/` |
| **Separation** | Agent Mode + Gather Mode + EditCodeService + VoidModelService | `/separated/primitives/*.yaml` |
| **Coordination** | Checkpoints + lint + rollback timeline | `/coordinated/graphs/`, `/coordinated/clusters/` |
| **Refactoring** | MCP Service + tool handlers → L1 Atom Store | `/refactored/modules/` |
| **Packaging** | TypeScript + React + Tailwind + Zod schemas | `/packages/sparc-*/` |
| **File Location** | Modular `contrib/void/` structure | `/repo/...` |
| **Repo Training** | Provider pipeline + checkpoints as anchors | `/repo/training/...` |
| **UI (BENTO-007)** | React 19 + Tailwind | Skill Registry, Checkpoint Timeline (F0→F3), MCP Registry |

---

## Hierarchy Position

```text
Cybernetic-Ava007
  └── a2a-exoskeleton
        ├── tekton-core/          ← Curation Workstation (Tekton Core, canonical)
        ├── forged-ai-filing-os   ← this repo (SPARC + turbovec)
        └── fapo-ran
              └── Ava007-Omni-OS
                    └── Agent-X
```

See `a2a-exoskeleton/tekton-core/INTEGRATION_CHECKLIST.md` for fork/adaptation steps.

## Related

- Radio / RAN: [`fapo-ran`](https://github.com/ingeniosity-A2A/fapo-ran)
- Memory: QAG-MemBrain
- turbovec index is queryable from Tekton Core via MCP tools
