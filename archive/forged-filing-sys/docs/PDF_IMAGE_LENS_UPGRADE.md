# PDF & Image Lens Upgrade — Infinity-Parser + LayoutRL

**Source blueprint**: *Dynamic Intelligence Model Upgrade: Outle AI Chat PDF & Image Lens Architecture*

This document integrates the high-fidelity document intelligence stack into Forged-AI-Filing-OS / SPARC + turbovec.

## 1. High-Fidelity PDF Ingestion (Infinity-Parser)

- **Core**: Infinity-Parser — end-to-end VLM trained on Infinity-Doc-400K (400 482 documents).
- **Dual construction**: synthetic (Jinja + Chrome) + real-world multi-expert pipeline.
- **Docling + TableFormer**: unified DocLang JSON, image-based table reconstruction.
- **MCP**: Model Context Protocol gives agents native navigation with coordinate provenance.
- **Target**: Rust-native **LiteParse** layer for pixel-level spatial mapping, vector-graphics recovery, AcroForm repair, and localized screenshots.

**SPARC mapping**: Intake → Separation. Every parsed document becomes primitives + embeddings written to turbovec.

## 2. Active Image Lens (V-Rubrics & Agentic Self-Correction)

| Dimension              | Goal                                      |
|------------------------|-------------------------------------------|
| Visual Faithfulness    | Eliminate hallucinations / visual leaking |
| Reasoning Consistency  | Sound path from observation to answer     |
| Instruction Following  | Match format, length, technical depth     |

**Autodata loop**: Challenger → Weak Solver → Strong Solver → Verifier.  
Objective: maximize Δ = S_strong − S_weak for potent RL gradients.

**Insight enforcement** reduces truncation rates from ~23.8 % to ~4 %.

## 3. Kernel Acceleration (Qwen2.5-VL + VeRL)

- Base model: **Qwen2.5-VL-7B** (native high-resolution perception).
- RL infrastructure: **VeRL** (HybridFlow).
- Enables real-time **LayoutRL** on dense multi-column documents.

## 4. LayoutRL Training

Rewards:
- R_dist  — Edit-distance (semantic + formatting)
- R_count — Paragraph / segment count fidelity
- R_order — Pairwise inversion checks for reading order

Optimizer: **GRPO** (Group Relative Policy Optimization) — no separate critic.

**Benchmarks (from blueprint)**:
- OmniDocBench: 0.141 EN / 0.197 ZH edit distance (SOTA)
- olmOCR-Bench: 82.5 overall
- PubTabNet 93.46 TEDS-S · FinTabNet 97.16 TEDS-S

## Integration Points in Forged-AI-Filing-OS

| Component              | Location                                      |
|------------------------|-----------------------------------------------|
| separation_policy.yaml | `config/separation_policy.yaml`               |
| PDF intake script      | `scripts/intake_pdf.py`                        |
| Audio intake (Whisper) | `scripts/intake_audio.py`                      |
| Semantic Explorer      | `components/bento/SemanticExplorer.tsx`       |
| GSAP trigger           | `components/bento/gsap_semantic_trigger.ts`   |
| makeMoE hybrid router  | `repo/refactored/moe_reference/`              |
| turbovec index         | `repo/vector_index/`                          |

The Image Lens acts as a quality gate before any document chunk is written to the turbovec index. LayoutRL continuously improves the parser itself.
