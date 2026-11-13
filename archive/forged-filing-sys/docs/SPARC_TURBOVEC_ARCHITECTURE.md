# SPARC + turbovec Integration: Complete System Architecture

**Omnibus / Forged-Filing-Sys**  
Ava007 Unified Intelligence Substrate

> **Governance note (canonical contract: `docs/FORGED_FILE_STANDARD.md`).** F0–F3 in this
> repository denote the Forged File Standard lifecycle (Raw Upload → Chunk → Forged File →
> Manifest). turbovec remains a **store-side concern** of the DuckDB Intelligence store —
> it is not a lifecycle stage and not a fourth intelligence layer. Hugging Face is the
> **vendor/input boundary**: whole-model vendoring happens OUTSIDE F0 → F3. SPARC
> orchestration is infrastructure around the Ava007 vault, not an Ava007 cognitive
> capability. Visual surfaces obey the three-color palette lock (neutral / orange / yellow).

## Core Addition: turbovec as the Search Layer

turbovec is not a replacement for any existing SPARC layer. It is a **new intelligence layer** that sits between Separation and Coordination, providing **online, incremental, memory-efficient semantic search** over everything the system processes.

| SPARC Layer | Without turbovec | With turbovec |
|-------------|------------------|---------------|
| **Intake** | Raw PDFs, links, models | Raw + **embedded vectors** for every artifact |
| **Separation** | Primitives as YAML | Primitives as YAML + **semantic index entries** |
| **Coordination** | Graph mapping | Graph mapping + **nearest-neighbor routing** |
| **Refactoring** | Module extraction | Module extraction + **similarity-based module grouping** |
| **Packaging** | Versioned bundles | Versioned bundles + **semantic package assembly** |
| **File Location** | Domain-based paths | Domain-based paths + **vector-indexed locations** |
| **Repo Training** | Pre-compiled traces | Pre-compiled traces + **live semantic retrieval** |
| **UI (BENTO-007)** | Visual dashboard | Visual dashboard + **live semantic exploration** |

The intelligence is already highly valuable. Pre-compiling reduces waste. turbovec makes the **pre-compiled intelligence searchable at streaming speed** with **~8× memory reduction** and **zero training phase**.

---

## System Entry Points

| # | Link | SPARC Layer | Function | File Location |
|---|------|-------------|----------|---------------|
| 1 | [arcee-ai/mergekit](https://github.com/arcee-ai/mergekit) | Refactoring | Executes `mergekit-moe` / expert merging | `/repo/refactored/modules/` |
| 2 | [mlabonne/frankenmoe](https://huggingface.co/blog/mlabonne/frankenmoe) | Coordination | Expert selection & routing patterns | `/repo/coordinated/moe_graphs/` |
| 3 | [RyanCodrai/turbovec](https://github.com/RyanCodrai/turbovec) | Search | Online, incremental, 4-bit vector index | `/repo/vector_index/` |
| 4 | [makeMoE](https://huggingface.co/blog/AviSoori1x/makemoe-from-scratch) | Refactoring + MoE construction | From-scratch Sparse MoE (Top-k / noisy Top-k) | `/repo/refactored/moe_reference/` |
| 5 | [whisper-large-v3-el-council-lora](https://huggingface.co/opencouncil/whisper-large-v3-el-council-lora) | Intake (multimodal) | Greek council ASR → transcript → embed | `/repo/intake/asr/` |
| 6 | Unsloth Llama-3.1-8B (Colab) | Repo Training / Expert specialization | 2× faster LoRA/QLoRA fine-tuning | `/repo/training/unsloth/` |
| 7 | **Tekton Core** (Ava007 adaptation of the Void editor) | Curation Workstation | Local-first AI editor, Agent/Gather modes, checkpoints, MCP | Primary IDE for SPARC |
| 8 | [fapo-ran](https://github.com/ingeniosity-A2A/fapo-ran) | RAN Capability | FAPO Lyapunov optimizer, srsRAN patches, SafetyEnvelope | Radio / ISAC stack |

---

## Full Pipeline (with Tekton Core + FAPO-RAN)

```
HUGGING FACE MODELS + PDFs + LINKS + AUDIO + RADIO TELEMETRY
        │
        ▼
┌─ SPARC INTAKE (Tekton Core + Infinity-Parser + Whisper + RANCapability) ──┐
│  Parse → Embed → turbovec.IdMapIndex (4-bit)                        │
└──────────────────────────────┬──────────────────────────────────────┘
                               ▼
┌─ SEPARATION (Tekton Core Agent/Gather + EditCodeService) ─────────────┐
│  Primitives + Embeddings + Vector Index                             │
└──────────────────────────────┬──────────────────────────────────────┘
                               ▼
┌─ COORDINATION (Tekton Core Checkpoints + turbovec NN routing) ─────────┐
│  Graphs + clusters + provenance audit                               │
└──────────────────────────────┬──────────────────────────────────────┘
                               ▼
┌─ REFACTORING (MergeKit + makeMoE + MCP handlers) ───────────────────┐
│  Modules + hybrid router                                            │
└──────────────────────────────┬──────────────────────────────────────┘
                               ▼
┌─ PACKAGING (Zod / TypeScript contracts via Tekton Core pipeline) ───────┐
│  F3 curated packages + turbovec_package.idx                         │
└──────────────────────────────┬──────────────────────────────────────┘
                               ▼
┌─ FILE LOCATION + REPO TRAINING + RAN CONTROL ───────────────────────┐
│  Vector-indexed registry + live retrieval + FAPO SafetyEnvelope     │
└──────────────────────────────┬──────────────────────────────────────┘
                               ▼
┌─ BENTO-007-UI (Tekton Core React 19 + SemanticExplorer + GSAP) ─────┐
│  Glassmorphic dashboard + Checkpoint Timeline (F0→F3)               │
└─────────────────────────────────────────────────────────────────────┘
```

See also:
- `docs/VOID_SPARC_MAPPING.md`
- `docs/PDF_IMAGE_LENS_UPGRADE.md`
- `docs/ENTRY_POINTS.md`
- `config/separation_policy.yaml`
