# AVA007 — White Paper → Framework Roadmap

Mapping the **Quantum Atomic GSAP MemBrain** white paper to the actual
codebase. This document is the single source of truth for what's built,
what's salvageable, and what's missing.

---

## L1–L6 Authority Chain Status

| Layer | White Paper Component | Codebase Location | Status |
|-------|----------------------|-------------------|--------|
| **L1** | Atomic Memory (SHA-256 signed JSONL atoms) | `lite_notebook/src/receipt.rs` | ⚠️ Partial — has SHA-256 content addressing, **missing signing + AtomMem directives** |
| **L2** | Tashi Consensus (DAG-based distributed state) | — | ❌ Missing — salvage from `files(9)/tashi_node.ts` |
| **L3** | GSAP Temporal Engine (deterministic replay) | `mobile-runtime/src/temporal/GSAPTemporal.ts` | ✅ Built (468 lines) |
| **L4** | Neo4j GraphRAG (deep context retrieval) | — | ❌ Missing — salvage from `files(9)/neo4j_graph.ts` + `.env` has `NEO4J_URI` |
| **L5** | Subconscious / Rev.Ike (read-only observation) | `meta_harness/src/classifier.rs` | ⚠️ Partial — classifies intents but **no "Science of Living" context lake** |
| **L6** | Executive / Ava-007 (sole decision authority) | `meta_harness/src/orchestrator.rs` | ⚠️ Partial — has turn() loop, **missing AtomMem CRUD + Mercury2 diffusion** |

---

## Core Components Status

| Component | White Paper Section | Codebase | Status |
|-----------|---------------------|----------|--------|
| **Lite Notebook LM** (the Dam) | §4 — structural regulator, overnight synthesis | `lite_notebook/` + `harness_evolution/` | ✅ Built |
| **Context Lake** (the Habitat) | §4 — pooled repository of LatentSkills | `context_lake/` (DuckDB) | ⚠️ Partial — no LatentSkills yet |
| **Open Notebook LM** (the Outflow) | §4 — HTML surface delivery | `mobile-runtime/mobile/capacitor/` | ✅ Built (React UI) |
| **Interaction Quanta** | §4 — signed JSONL atoms | — | ❌ Missing — salvage from `Latent-skill/interaction_quantum.ts` |
| **Binary Ninja Agent (`bn`)** | §5 — Preview-then-Commit binary audits | — | ❌ Missing — build new `goose/src/binary_ninja.rs` |
| **WASM-native Capabilities IR** | §5 — evolvable capabilities in sandboxes | — | ❌ Missing — build new `capabilities/` crate |
| **FAPO Selection** | §5 — Fractional Pareto-Optimality Arena | — | ❌ Missing — build new `fapo/` crate |
| **Artificial ACC** | §2 — conflict monitoring + self-correction | — | ❌ Missing — build new `meta_harness/src/acc.rs` |
| **GRPO Training Harness** | §7 — zero-cost personalization | — | ❌ Missing — salvage from `The_integration_point/grpo_harness.py` |
| **Latent Skills** | §4 — procedural knowledge habitat | — | ❌ Missing — salvage from `Latent-skill/latent_skill.py` |
| **Griptape Harness** | §5 — specialized tooling | `goose/src/lib.rs` (stub) | ⚠️ Stub — salvage from `Griptape-more/griptape_harness.py` |

---

## Model Backends Status

| Model | White Paper Role | Constellation Registry | Status |
|-------|-----------------|----------------------|--------|
| **Gemma 2B** | Reflex (on-device, <5ms) | `ModelId::Gemma2B` (port 8080) | ✅ Built |
| **Gemma 4 12B** (FABLE) | Planning / synthesis | `ModelId::Gemma12B` (port 8081) | ✅ Built |
| **Mellum2** (MoE 12B/2.5B active) | Executive tier — routing + planning | — | ❌ Missing — salvage from `files(8)/executive.ts` |
| **Mercury2** (diffusion) | Cortex tier — deep reasoning, policy | — | ❌ Missing — salvage from `files(8)/cortex.ts` |
| **Embedding 384** | VSS recall | `ModelId::Embedding384` (port 8082) | ✅ Built |
| **Claude / GPT-4o** | Cloud fallback | `ModelId::Claude` / `ModelId::GPT4o` | ✅ Built (not yet wired to real APIs) |
| **Qwen 2.5 7B** | Multilang fallback | `ModelId::Qwen7B` (port 8083) | ✅ Built |

---

## Hardware Grounding Status

| Component | White Paper Section | Status |
|-----------|---------------------|--------|
| **Termux Compatibility** | §6 — USB serial bridge | ✅ Built (`mobile_runtime/`) |
| **Wi-Fi Aware NAN** | §6 — cross-platform mesh | ⚠️ In `goose/src/meshrabiya.rs` (mDNS only — needs real NAN) |
| **5-tier Proximity** | §6 — UWB/NFC/NAN/Blecon/A2A-BEEP | ❌ Missing — salvage from `The_integration_point/protocols.ts` |
| **LoRa Swarm (SX1262 + ESP32)** | §6 — encrypted self-healing mesh | ❌ Missing — hardware project (separate repo) |
| **NVFP4 Quantization (Blackwell)** | §6 — 3-4x throughput for Diffusion Gemma | ❌ Missing — desktop-only (RTX 1490/1590) |

---

## Cloudflare + Telnyx Status

| Component | Status |
|-----------|--------|
| Cloudflare Worker (Telnyx proxy) | ✅ Deployed at `ava007-telnyx-proxy.brian-fb2.workers.dev` |
| Telnyx API key (secret) | ✅ Set on Worker |
| Device token auth | ✅ Working |
| SMS send via Worker | ✅ Working (Telnyx API responds) |
| SMS delivery to US numbers | ❌ Blocked — needs 10DLC registration |
| WhatsApp Business API | ❌ Pending Meta approval |
| Phone number `+14044391350` | ✅ Active on Telnyx (no WhatsApp yet) |
| Inbound webhook ingress | ✅ Worker `/webhook` endpoint ready |

---

## Salvage Plan — 12 Files from Zips

| # | Source | Target | Layer | Action |
|---|--------|--------|-------|--------|
| 1 | `files(9)/tashi_node.ts` (227 lines) | `lite_notebook/src/tashi_consensus.rs` | L2 | Port TS→Rust |
| 2 | `Latent-skill/interaction_quantum.ts` (203 lines) | `lite_notebook/src/interaction_quantum.rs` | L1 data unit | Port TS→Rust |
| 3 | `files(9)/neo4j_graph.ts` (266 lines) | New `graph_rag/` crate | L4 | Port TS→Rust |
| 4 | `files(8)/cortex.ts` (197 lines) | `constellation/src/backends/mercury2.rs` | Model | Port TS→Rust |
| 5 | `files(8)/executive.ts` (216 lines) | `constellation/src/backends/mellum2.rs` | Model | Port TS→Rust |
| 6 | `files(9)/dual_brain.ts` (377 lines) | `meta_harness/src/cortex.rs` | L6 Cortex tier | Port TS→Rust |
| 7 | `The_integration_point/protocols.ts` (220 lines) | `goose/src/proximity.rs` | Hardware | Port TS→Rust |
| 8 | `The_integration_point/grpo_harness.py` (255 lines) | New `training/` crate | Training | Keep Python |
| 9 | `Latent-skill/latent_skill.py` (296 lines) | New `skills/` module | L4 habitat | Keep Python |
| 10 | `Griptape-more/griptape_harness.py` (370 lines) | `goose/services/griptape_harness.py` | Tooling | Keep Python (replace stub) |
| 11 | `Griptape-more/ava007.ts` (AtomMem CRUD portion) | Extend `meta_harness/src/orchestrator.rs` | L6 | Extract + port |
| 12 | `Griptape-more/atomic_memory.ts` (signing portion) | Extend `lite_notebook/src/receipt.rs` | L1 | Extract + port |

---

## Build Plan — Missing White Paper Components

| # | Component | Target | Priority | Effort |
|---|-----------|--------|----------|--------|
| 1 | **Binary Ninja Agent** (`bn`) | `goose/src/binary_ninja.rs` | Medium | New — Preview-then-Commit binary audit loop |
| 2 | **FAPO Selection** | New `fapo/` crate | High | New — Fractional Pareto-Optimality Arena for capability selection |
| 3 | **Artificial ACC** | `meta_harness/src/acc.rs` | Medium | New — conflict monitoring + drift detection + self-correction |
| 4 | **WASM-native Capabilities IR** | New `capabilities/` crate | High | New — evolvable capability sandboxes (was "Genes" in white paper — corrected to "Capabilities" per framework terminology) |
| 5 | **Cloudflare Vectorize** | Future | Low | Future work |
| 6 | **DID key management** | Future | Low | Future work |
| 7 | **YouTube/Whisper ingestion** | Future | Low | Future work |

---

## Execution Order

1. **ROADMAP.md** (this file) — commit first so the plan is visible
2. **Salvage L1/L2** — tashi_consensus.rs + interaction_quantum.rs + receipt signing extension
3. **Salvage L4** — graph_rag crate (Neo4j)
4. **Salvage model backends** — mercury2.rs + mellum2.rs in constellation
5. **Salvage L6 Cortex** — cortex.rs in meta_harness
6. **Salvage hardware** — proximity.rs in goose (5-tier mesh)
7. **Salvage Python** — training/ + skills/ + griptape_harness.py
8. **Build missing** — Binary Ninja, FAPO, Artificial ACC, Capabilities IR
9. **Compile + test** — verify everything builds
10. **Push to main** — single commit with full white paper alignment

---

## Terminology Corrections

The white paper uses some terms that don't match the framework's actual
codebase terminology. This roadmap uses the **framework's terms**:

| White Paper Term | Framework Term | Used In |
|-----------------|----------------|---------|
| "Genes" | **Capabilities** | `constellation/`, `meta_harness/router.rs` |
| "AtomMem" | **Receipt** (+ directives) | `lite_notebook/receipt.rs` |
| "Posterior / Prefrontal" | **Subconscious / Executive** | `meta_harness/` (Route::RevIke / Route::Fable) |
| "Interaction Quanta" | **Interaction Quanta** (kept — canonical) | New module |
| "HolographicReconstructor" | **GSAPTemporalReconstructor** | `mobile-runtime/src/temporal/` |

---

*This roadmap is the canonical reference for AVA007 framework alignment
with the Quantum Atomic GSAP MemBrain white paper. Update it as components
are built or salvaged.*
