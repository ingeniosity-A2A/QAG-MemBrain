# Ingenosity Core v3.0 — MemBrain Architecture Revamp

**Document ID:** AVA007-MEMBRAIN-V3-2026-001
**Classification:** Architecture — Open Distribution
**Date:** 2026-06-30
**Status:** Ready for implementation

---

## 1. Executive Summary

The Ingenosity Core v3.0 architecture replaces QAG-MEMBRAIN entirely. But it's not a swap — it's an absorption. Everything QAG-MEMBRAIN did, the new architecture does better, plus capabilities it couldn't support.

---

## 2. What QAG-MEMBRAIN Was

```
QAG-MEMBRAIN (previous architecture):

  Qdrant (vector DB)
    → Store embeddings
    → Semantic search
    → Similarity queries

  Agent Memory Brain
    → Short-term context
    → Long-term storage
    → Retrieval for reasoning

  Limitations:
    → Flat memory (no depth layers)
    → No external context awareness
    → No organization between ingestion and storage
    → No schema evolution
    → No audio/narration
    → No topic clustering
    → Single consumption mode (query → results)
    → No confidence scoring at ingestion
    → No multi-engine OCR routing
```

---

## 3. What Replaces Each Component

| QAG-MEMBRAIN Component | v3.0 Replacement |
|---|---|
| Qdrant (vector search) | Context Lake Deep Layer (ChromaDB + graph + JSON + time-series) |
| Agent Memory (short-term) | Dam Intake Pool (items live briefly before clustering) |
| Agent Memory (long-term) | Context Lake Deep Layer (atomic memories with full metadata) |
| Memory retrieval | Context Lake Query Interface (10 query types across 4 depths) |
| Memory for reasoning | Cognition Engine (reads from all 4 lake layers) |
| Single storage backend | Four-layer reservoir (Surface → Channels → Deep → Bedrock) |

---

## 4. What QAG-MEMBRAIN Couldn't Do

| Capability | QAG-MEMBRAIN | v3.0 |
|---|---|---|
| Organize incoming data into topics | No | Yes (Dam) |
| Generate summaries from raw streams | No | Yes (Dam Summarizer) |
| Produce audio narrations | No | Yes (Audio Narrator) |
| Layer storage by depth | No | Yes (4 layers) |
| Detect schema changes | No | Yes (Push + Pull) |
| Evolve schema automatically | No | Yes (3-phase convergence) |
| Inject external world context | No | Yes (last30days-skill) |
| Score memory value (8 dimensions) | No | Yes |
| Route OCR to specialized engines | No | Yes (5 engines) |
| Score confidence at ingestion | No | Yes (every item) |
| Store relationships (Channel Graph) | Limited | Yes |
| Multiple consumption modes | Query only | Listen/Read/Ask/Explore/Generate |
| Live product scoring (35,700 products) | No | Yes |
| Mobile-first data collection | No | Yes (Bilt + S25 Ultra) |
| Discovery engine | No | Yes |

---

## 5. Storage Architecture

### v3.0 — Five Storage Backends

```
ChromaDB (replaces Qdrant)
  └── Collection: embeddings
      └── Context Lake Deep Layer — semantic search only

PostgreSQL (new — structured store)
  ├── ingested_items      (every raw input)
  ├── topic_channels      (Dam output)
  ├── channel_items       (channel ↔ item mapping)
  ├── sub_topics          (granular topics)
  ├── products            (Ingenuity Lens: 35,700+)
  ├── schema_evolutions   (evolution audit trail)
  ├── external_signals    (last30days output)
  ├── assembly_sessions   (HAS active sessions)
  └── audit_log           (governance trail)

Redis (new — hot cache)
  ├── Surface summaries   (instant access)
  ├── Topic index         (fast listing)
  ├── Sentiment dashboard (cached readings)
  └── Session state       (active assemblies)

DuckDB (new — analytical store)
  ├── Product embeddings  (visual search)
  ├── Time-series data    (trend tracking)
  └── Aggregation queries (analytics)

File System (new — audio)
  └── /data/audio/        (podcast narrations)
```

v3.0 has FIVE storage backends. QAG-MEMBRAIN had ONE. Each backend is optimized for its purpose.

---

## 6. Four-Layer Reservoir

```
Surface Layer   →  Redis (hot cache, instant access)
                   Summaries, sentiment, session state

Channel Layer   →  PostgreSQL (organized topics)
                   Dam output, topic clusters, channel graph

Deep Layer      →  ChromaDB + DuckDB (semantic + analytical)
                   Atomic memories, embeddings, time-series

Bedrock Layer   →  File system (permanent)
                   Audio narrations, exports, backups
```

---

## 7. What Gets Preserved from QAG-MEMBRAIN

| Idea | Where in v3.0 |
|---|---|
| Store memories as embeddings | Context Lake Deep Layer (ChromaDB) |
| Retrieve by semantic similarity | Context Lake QueryType::SemanticSearch |
| Agent uses memory for reasoning | Cognition Engine (reads all 4 layers) |
| Short-term and long-term memory | Dam (short) + Deep Layer (long) |
| Atomic memory units | Golden rule: One JSON = one atomic memory |
| Vector + metadata retrieval | Deep Layer: vector + graph + JSON (3 indexes) |
| Memory influences decisions | CFGL value scoring → Tekton (8 dimensions) |

---

## 8. The Conceptual Shift

**QAG-MEMBRAIN thinking:**
> "I have a vector database. I store memories in it. I query them when I need them. The agent has memory."

**v3.0 thinking:**
> "Information flows like water. It enters through the ingestion river. It's organized by the Dam. It's stored in a layered reservoir. It's consumed through multiple outlets. The system doesn't have memory. The system IS memory. Every layer perceives, organizes, learns, and evolves continuously."

---

## 9. Migration Path

1. **Keep QAG-MEMBRAIN running** (don't break production)
2. **Deploy v3.0 alongside** → Docker Compose: PostgreSQL + Redis + ChromaDB
3. **Export Qdrant memories** → scroll API → JSONL dump
4. **Import into Context Lake** → Deep Layer ingests → Dam re-clusters → summaries + audio generated
5. **Validate** → Query both in parallel, compare retrieval quality
6. **Switch over** → Point API to v3.0, decommission Qdrant (keep backup 30 days)
7. **Enable new capabilities** → External Intelligence, Audio, Schema Evolution, Discovery Engine

---

## 10. Five Consumption Modes

| Mode | What It Does |
|---|---|
| **Listen** | Audio narration of memory (podcast-style) |
| **Read** | Text summary of channel/topic |
| **Ask** | Traditional query (semantic search) |
| **Explore** | Navigate topic graph interactively |
| **Generate** | Create new content from memory synthesis |

QAG-MEMBRAIN only had "Ask". v3.0 has all five.

---

## Decision: New Repo or Existing?

**Recommendation: Build in QAG-MemBrain repo (main branch).**

Rationale:
- QAG-MemBrain already has the Rust crates (lite_notebook, context_lake, graph_rag, meta_harness, constellation, harness, fapo, capabilities, harness_evolution, goose, telnyx, cloudflare_mesh, mobile_runtime)
- v3.0 is an *absorption* of QAG-MEMBRAIN, not a separate system
- The Rust crates already implement most of the Deep Layer (Iceberg + DuckDB + Arrow)
- Adding ChromaDB + PostgreSQL + Redis is additive (new crates alongside existing ones)
- A new repo would fragment the codebase and break the workspace

**The QAG-MemBrain repo IS the MemBrain repo. v3.0 is its evolution.**
