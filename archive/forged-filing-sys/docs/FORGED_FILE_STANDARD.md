# Forged File Standard (FFS) v1.2.0

**Governing ingestion, capability & asset-governance specification for Forged-AI-Filing-OS (Ava007) and Mastering-Ava007-Curation.**

> This document is the canonical contract. Every artifact crossing the Ava007 vault boundary
> must satisfy it. Implementations, dashboards, and intake scripts comply or do not ship.
> v1.1.0 adds: the Capability compile unit, the artifact detector, RocksDB namespace
> control plane, the immutability/versioning matrix, and the binding UI contract.
> v1.2.0 removes the harness layer: **Capability = Tools + Harness**, compiled inside the
> **Exoskeleton substrate** — there is no separate harness architecture (§1.1, §6).

---

## 1. Position: infrastructure around the vault, not cognition inside it

The Forged File pipeline is **infrastructure around the Ava007 intelligence vault**. It is not
an Ava007 cognitive capability, and orchestration does not belong inside Ava007.

```
AVA007 VAULT
        │
        ▼
THE CURATED EXOSKELETON CONFIGURATION
        │
        ▼
┌──────────────┐
│ PRE-CHECK    │
│ F0 Boundary  │
└──────┬───────┘
        │
        ▼
┌──────────────┐
│ INTERCEPT    │
│ / STREAM     │
└──────┬───────┘
        │
        ▼
┌──────────────┐
│ F1 CHUNK     │
│ GSAP SPLIT   │
└──────┬───────┘
        │
        ▼
┌──────────────┐
│ REFACTOR /   │
│ NORMALIZE    │
└──────┬───────┘
        │
        ▼
┌──────────────┐
│ EXOSKELETON  │
│ SUBSTRATE    │
└──────┬───────┘
        │
        ▼
┌──────────────┐
│ F2 FORGED    │
│ FILE         │
└──────┬───────┘
        │
 ┌──────┴──────┐
 ▼             ▼
┌────────────┐ ┌──────────────┐
│  ROCKSDB   │ │   DUCKDB     │
│   SKILLS   │ │ INTELLIGENCE │
└─────┬──────┘ └──────┬───────┘
        └───────┬───────┘
                ▼
        ┌──────────────┐
        │ F3 MANIFEST  │
        │ provenance + │
        │ backlinks    │
        └──────────────┘

HUGGING FACE VENDOR (outside this pipeline)
        │
        ▼
   VENDOR IMPORT
     ├── config
     ├── tokenizer
     ├── model metadata
     ├── model weights
     └── revision / hash
```

**Layer semantics (authoritative):**

| Element        | Classification                            |
|----------------|-------------------------------------------|
| RocksDB        | Skills — executable procedural knowledge; **the control plane** |
| DuckDB         | Intelligence — structured knowledge       |
| Hugging Face   | Vendor/input boundary — vendored models & assets. **Not** a fourth intelligence layer |
| F0 → F3        | The forging lifecycle                     |
| GSAP           | Mandatory visual language for F1 chunking; **temporal kernel** |
| F3             | Provenance & relationship graph           |
| Exoskeleton    | **Substrate / execution environment around Ava007** — Capabilities belong here |
| Skills         | Intelligence / firmware                   |
| DEV-locked     | Specified but not yet operational         |

### 1.1 Canonical vocabulary (non-negotiable)

The Exoskeleton is the superior execution substrate **around** Ava007 — not a wrapper or
harness around it. Ava007 remains Ava007 (cognition/identity); orchestration stays outside
Ava007. There is **no harness layer**: no "Capability Harness", no "harness architecture".

| Forbidden concept   | Canonical term                            |
|---------------------|-------------------------------------------|
| Harness (as a layer)| Exoskeleton                               |
| Capability Harness  | Exoskeleton substrate                     |
| Harness layer       | Exoskeleton layer / substrate primitive   |
| Harness execution   | Exoskeleton execution                     |
| Harness around Ava  | Exoskeleton around Ava007                 |
| Harness capabilities| Exoskeleton capabilities                  |

Implementation direction (binding):

```
Ava007 → Exoskeleton → substrate primitives → Rev.ike / memory →
RocksDB / DuckDB → Aetheris spatial UI → GSAP temporal kernel
```

Within a compiled Capability (§6), the word **harness** survives in exactly one place: as
the execution-boundary section of the Capability entity itself. It is never a layer,
never a stage, and never an architecture.

**Three colors only:** neutral / orange / yellow. This palette governs every visual surface
of the pipeline.

**Curation vs forging.** Curation selects/refines what Ava007 *should* use; forging governs
what has actually been *produced, classified, stored, and traced*. Mastering-Ava007-Curation
is the curation/control surface; Forged Files are the governed artifacts of the pipeline.

---

## 2. Lifecycle stagesEvery file entering the vault traverses exactly one path:
**Pre-check → Intercept/Stream → F0 → F1 → Normalize → Exoskeleton Substrate Binding →
F2 → stores → F3**. No stage may be skipped. Each stage validates its input; a failed validation halts forging
and the artifact remains at its last valid stage.

### Pre-check — F0 Boundary
- Gate before any bytes cross the F0 boundary: size limit, MIME hint, explicit source.
- A failed pre-check refuses entry; nothing is written.

### Intercept / Stream
- The stream is **intercepted and identified, never blindly truncated** (see §4).
- The detector's verdict routes the artifact: forgeable content continues to F0; vendor
  model artifacts route to the vendor import; unknown formats are quarantined.

### F0 — Raw Upload
- Bytes are written immutably under `vault/raw/<sha256>/`.
- Path name = SHA-256 content digest. Immutability on arrival.
- Required sidecar: `raw.json` (source, mime, size, sha256, detector verdict).
- No parsing, no classification at this stage.

### F1 — Chunk (GSAP Split Text)
- Content is split by structure, never by arbitrary byte counts: headings, paragraphs,
  tables, code blocks, list items — in document order.
- Every chunk carries `{ doc_id, chunk_index, start_offset, end_offset, kind }`.
- Chunks must be **reversible** to F0 content by concatenating chunk texts with their
  recorded verbatim trailing separators (a single blank line, `"\n\n"`, in the common case).
- No vectorization at F1. Embedding is a store-side concern, not a stage.
- `GsapF1Visualizer` emits the mandatory visual language events (three colors only) for
  any UI observing F1; it must not mutate chunk data.

### Normalize / Refactor
- Whitespace normalization is **not allowed to change byte semantics**: normalization is
  recorded as metadata and is only applied to presentation copies. F1 reversibility
  always targets the raw F0 bytes.

### Exoskeleton Substrate Binding
- Chunks destined for executable use are bound to substrate execution context
  (entrypoint contract, inputs, outputs, permissions) as described in §6. The substrate
  never executes anything by itself during forging.

### F2 — Forged File
- F1 chunks are bound into a single self-describing artifact:
  `{ spec, version, file_id, f0 { sha256, size, mime }, chunks[], stats, forged_at }`.
- `file_id` = first 16 hex of the F0 SHA-256 (stable, derived, no separate ID space).
- Chunk offsets are re-verified against the F0 digest at forge time. A mismatch rejects
  the forge.
- F2 artifacts are written to `vault/forge/forged/<file_id>.forged.json` (references F0,
  never duplicates its bytes).
- Classification is mandatory: chunks classify as `code` or `intelligence`, routing them
  to RocksDB or DuckDB respectively.

### Stores (F2 → dual store)
- **RocksDB Skills Store** — executable procedural knowledge (code chunks) **and the
  control plane** (§5). Backend `rocksdb` (rocksdict) or a DEV-locked file-JSON fallback.
- **DuckDB Intelligence Store** — structured knowledge: SQL over `intelligence_chunks`,
  supports `classification` and `domain` filters. Backend `duckdb` or a DEV-locked
  file-JSON fallback.
- Fallback backends persist to disk so governance verification works without the
  native engines; they are registered in the DEV-lock register (§8).
- No vectorization is required to enter either store (see §3.5).

### F3 — Manifest (append-only)
- The single source of truth for provenance and the relationship graph.
- Records every forged file with `file_id`, F0 digest, size, mime, chunk counts,
  per-store counts, backlinks, and both ISO-8601 timestamps.
- Backlinks are the F3 graph: **source → forged file** and **forged file → store placement**.
  An entry without backlinks is not a completed F3 record.
- Backlink targets must reference existing nodes. Dangling backlinks fail validation.

---

## 3. Immutability & versioning matrix (binding)

| Stage    | Mutable?      | Purpose                        |
|----------|---------------|--------------------------------|
| F0 Raw   | No            | Original evidence              |
| F1 Chunk | No            | Deterministic chunk artifact   |
| F2 Forged| No            | Governed classified artifact   |
| F3 Manifest | Append-only| Relationships / provenance     |

If content changes, a **new version** is generated: `forged_id`, `forged_id:v2`,
`forged_id:v3` — never silent modification of a historical artifact. This yields the
traceability chain F3 exists for:

```
Why does this skill exist?
      ↓
Which Forged File produced it?
      ↓
Which chunk produced that?
      ↓
Which upload produced that?
      ↓
Which vendor/model/dependency contributed?
```

---

## 4. Vendor isolation & the artifact detector

**Hugging Face is not a fourth intelligence layer.** A model does not become a Forged File
merely because a Capability uses it. Vendor imports keep their own governance:

```
Hugging Face
     │
     ▼
VENDOR IMPORT
     ├── config
     ├── tokenizer
     ├── model metadata
     ├── model weights
     └── revision / hash
```

- Weights stay in the **Hugging Face vendor / content-addressed store**, never in RocksDB.
- The vendor system may provide model **metadata** to the Capability system; the original
  model artifact remains an independently governed vendor asset, addressable via
  `vendor://` URIs (§7).

### The detector (no blind truncation)
The assumption "first 5 MB typically contains model layouts/safetensor headers" is
**unsafe** and is forbidden. A robust implementation understands the actual artifact
format; sharding, protobuf graph data, and multi-file repositories mean the first bytes
never contain everything needed.

```
HF Repository
     │
     ▼
Artifact Detector
     ├── safetensors parser
     ├── GGUF parser
     ├── ONNX parser
     ├── tokenizer/config parser
     └── unknown → quarantine
             │
             ▼
       Model Intelligence
             │
       ┌─────┴─────┐
       ▼           ▼
    DuckDB      RocksDB
   metadata     reusable
   / facts       skills
```

- **safetensors**: parse the JSON header (declared length, then key→dtype/shape map);
  refuse to guess when the header is absent or truncated.
- **GGUF**: parse the magic + version + tensor/metadata counts; read declared metadata
  kv-count, never fixed byte windows.
- **ONNX**: protobuf wire inspection (field-presence heuristics only); full graph parsing
  is out of scope until a protobuf parser is pinned.
- **tokenizer/config** (JSON): parse the actual JSON document.
- **unknown → quarantine**: the artifact is stored at `vault/quarantine/<sha256>/` with a
  verdict record and never enters F0 forging.

Only **metadata/facts** derived from headers are exported: model intelligence goes to
DuckDB; reusable parsing skills go to RocksDB. **Weights never leave the vendor store.**

---

## 5. RocksDB — the control plane (namespaces, not composite strings)

RocksDB is strongest as the **operational capability catalog**. Keys are namespaced:

```
skill:{skill_id}
capability:{capability_id}
asset:{asset_id}
layer:{stack_id}:{layer_id}
idx:hash:{hash}
idx:asset:{asset_id}
manifest:{forged_id}
stack:{job_id}:{frame_id}:{depth}
```

Render-stack values, for example:

```json
{
  "asset_id": "asset_01J...",
  "uri": "vendor://...",
  "type": "texture",
  "blend_mode": "normal",
  "transform": {},
  "enabled": true
}
```

Clean separation: **RocksDB stores the control plane; the renderer owns the actual
GPU/CPU asset lifecycle.**

---

## 6. Capability = Tools + Harness — the compile-time unit

A Capability is **not** synonymous with a harness, and there is no harness architecture.
Capability is the complete executable unit produced by combining:

```
TOOLS
  +
HARNESS
  ↓
CAPABILITY
```

- **Tools** — what it can use/do.
- **Harness** — the execution boundary/context that makes those tools usable.
- **Capability** — the resulting governed, executable unit.

Compiled structure:

```
CAPABILITY
├── dependencies
├── tools
├── skill
├── harness
├── inputs
├── outputs
├── permissions
├── validation
└── provenance
```

```json
{
  "capability_id": "cap_pdf_semantic_extractor_v1",
  "dependencies": {},
  "tools": {},
  "skill": {},
  "harness": {},
  "validation": {},
  "provenance": {}
}
```

- The capability is the **thing the runtime can actually load** — the compile product of
  the Exoskeleton substrate binding, not an arbitrary document.
- **Capabilities belong to the Exoskeleton** (the substrate around Ava007), never to a
  separate harness layer.
- Compiled capabilities register in the control plane at `capability:{capability_id}` and
  their skill fragments at `skill:{skill_id}`.

---

## 7. Folder schema (vault layout)

```
vault/
├── raw/<sha256>/            F0: content.bin + raw.json   (immutable)
├── quarantine/<sha256>/     detector-unknown artifacts   (immutable)
├── vendor/
│   ├── imports/<sha256>/    vendored artifacts + import.json (immutable)
│   ├── meta/{repo_id}.json  model metadata/facts (DuckDB-exported)
│   └── indexes/             model intelligence indexes
├── forge/
│   ├── forged/<file_id>.forged.json            F2 (immutable)
│   └── capabilities/<capability_id>.cap.json   §6 compile products (immutable)
└── manifest.json            F3 (append-only)
```

---

## 8. Governance rules (enforced, not advisory)

1. **Single lifecycle, no skip.** Every file follows Pre-check → F0 → F1 → … → F2 → stores
   → F3. No stage may be skipped.
2. **Immutability.** F0/F1/F2 artifacts are write-once (matrix §3); F3 is append-only.
   Changes produce new versions (`forged_id:vN`), never silent modification.
3. **Reversibility.** F1 chunks reconstruct F0 bytes exactly.
4. **Stable addressing.** `file_id` is a pure function of F0 content (SHA-256).
5. **Vendor isolation.** HF whole-model vendoring happens **outside F0 → F3**; weights stay
   in the vendor store, never RocksDB. No blind truncation of model streams — the detector
   routes by actual format, unknown → quarantine.
6. **Mandatory classification.** Chunks classify as `code` → RocksDB or `intelligence` →
   DuckDB.
7. **Palette lock.** Three colors only — neutral / orange / yellow (§9).
8. **DEV-lock accounting.** Specified-but-not-operational capabilities are registered with
   their reason; unregistered DEV items fail validation. The register (mirrored in
   `standard.py :: DEV_LOCKED`):
   - RocksDB/DuckDB fallback backends — file-JSON persistence until native engines are pinned.
   - GSAP F1 visualizer consumers (BENTO UI) — visual language consumers not yet wired.
   - Curation-config wiring (Mastering-Ava007-Curation explorer surfaces) — not yet wired into this repo.
   - Detector parsers for sharded safetensors / full ONNX protobuf graph — metadata-presence heuristics only.
   - Rev.ike zero-copy streaming substrate — specified with measured targets (0.00 MB RAM delta
     @ 50,000 records, 8,434.3 records/sec per the Aetheris architecture guide); substrate
     primitive not yet present in this repo.
9. **Agent awareness.** Intelligence is offered to agents only via manifests; forge
   identities are verified before consumption.

## 9. UI contract (binding)

### Three-color palette — absolute

```
NEUTRAL   shell · F0 · F1 · F3 · vendor storage · system infrastructure
ORANGE    RocksDB · Skills · executable capabilities
YELLOW    DuckDB · Intelligence · structured knowledge
```

No fourth semantic accent.

### Animation semantics — never decoration

```
UPLOAD           → ASCII GLITCH RIPPLE
F1 CHUNK         → GSAP SPLIT TEXT (characters/words physically separate)
NUMERIC DATA     → ODOMETER
F0→F1→F2→F3      → SLIDE (never generic fade transitions)
DEV-LOCKED       → visible · inert · reduced opacity + lock glyph
```

### DEV-locked surfaces
Visible and inert: reduced opacity, lock glyph, no interaction. DEV-locked must never be
hidden or removed — it is part of the interface's honesty.

---

## 10. Mastering-Ava007-Curation — interface tree

```
MASTERING-AVA007-CURATION
│
├── CORE PARAMETERS
│
├── THE CURATED EXOSKELETON CONFIGURATION
│   ├── Manifesto Collection
│   ├── Beyond The Rainbow Learning
│   ├── VLA
│   └── Voice / Audio Intelligence
│
├── FORGED FILE ENGINE
│   ├── F0 Raw
│   ├── F1 Chunk
│   ├── F2 Forge
│   └── F3 Manifest
│
├── CAPABILITY CATALOG
│   ├── Dependencies
│   ├── Tools · Harness
│   └── Skills
│
├── ROCKSDB
│   └── Forged Skills
│
├── DUCKDB
│   └── Forged Intelligence
│
├── HUGGING FACE
│   └── Vendor Assets
│
└── REALTIME SANDBOX
    └── Ava007 Creative Output
```

The Sandbox is **downstream of curation**: it shows what the currently selected
configuration actually produces; it does not define architecture.

### The Forged File Explorer (canvas contract)

The existing file explorer is the canvas. Its primitives are re-skinned and re-architected
for the Forged File Standard — **not** replaced with a new unrelated UI. The structural
primitives and their mapping:

| Explorer primitive | FFS mapping |
|--------------------|-------------|
| title/path bar     | vault root + current FFS zone (F0/F1/F2/F3/vendor/quarantine) |
| left navigation    | lifecycle zones (F0 Raw, F1 Chunk, F2 Forged, F3 Manifest, RocksDB, DuckDB, HF Vendor, Capability) |
| central file canvas| Forged asset cards (stage badge, destination, confidence, chunks, DEV state) |
| grid/list modes    | same data, two densities |
| breadcrumbs        | `vault / F2 Forged / {file_id}` |
| search             | filters by id, source, domain, destination |
| sorting            | by forged_at, confidence, chunk count, size |
| right-side inspector | provenance chain + capability panels (below) |
| status bar         | manifest summary + DEV-lock count |
| self-contained data island | `explorer_state.ts` state model, no external backend |

**Asset card** (replaces "invoice-014.pdf / Document / 128 KB"):

```
┌────────────────────────────┐
│ F2                         │
│ ◈ PDF Smart Extractor      │
│ FORGED FILE                │
│ confidence 0.94            │
│ chunks 018                 │
│ destination ROCKSDB        │
│ DEV LOCKED                 │
└────────────────────────────┘
```

**Inspector** (the control/provenance panel):

```
FORGED FILE
────────────────
Forged ID · Source Upload · Chunk Range · Engine · Destination · Confidence · Created · DEV Status

PROVENANCE
────────────────
F0 Raw Upload → F1 Chunk → F2 Forged File → F3 Manifest

CAPABILITY  (= Tools + Harness)
────────────────
Dependencies · Tools · Harness
```

---

## 11. Compliance tooling

- `python -m forged_ai_filing_os.main validate` runs all governance invariants and must
  exit 0 on a compliant vault.
- `python -m forged_ai_filing_os.main verify --file-id <id>` checks chunk reversibility
  and store placement for a single forged file.
- `python -m forged_ai_filing_os.main spec` prints the current spec version.
- `python -m forged_ai_filing_os.main trace <file_id>` prints the §3 traceability chain.
- The `ForgedFileStandard` class is the machine-readable source of truth for stage order,
  stores, namespaces, immutability matrix, palette, animation semantics, and DEV-lock
  accounting; `spec_version` MUST equal the heading version of this document.

## 12. Change control

- This spec is versioned. Any change to stage semantics, store contracts, namespace
  schema, the immutability matrix, palette, animation semantics, or governance rules bumps
  the version and requires updating `spec_version` in
  `forged_ai_filing_os/forging/standard.py`.
- Companion repos (Mastering-Ava007-Curation, fapo-ran) are consumers; they must track
  this spec's version and may not fork the lifecycle semantics.
- The Mastering-Ava007-Curation explorer implements the §10 canvas contract on its
  existing primitives.
