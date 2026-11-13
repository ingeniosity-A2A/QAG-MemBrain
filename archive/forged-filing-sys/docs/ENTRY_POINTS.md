# SPARC System Entry Points

Quick reference for the key external projects wired into Forged-Filing-Sys / SPARC.

> Hugging Face resources (rows 4–5) are the **vendor/input boundary**: whole-model
> vendoring happens OUTSIDE the F0 → F3 forging lifecycle (see `docs/FORGED_FILE_STANDARD.md`).

| # | Resource | Layer | Role |
|---|----------|-------|------|
| 1 | [arcee-ai/mergekit](https://github.com/arcee-ai/mergekit) | Refactoring | MoE / expert merging (`mergekit-moe`) |
| 2 | [mlabonne/frankenmoe](https://huggingface.co/blog/mlabonne/frankenmoe) | Coordination | Expert selection & routing patterns |
| 3 | [RyanCodrai/turbovec](https://github.com/RyanCodrai/turbovec) | Search | Online 4-bit quantized vector index |
| 4 | [makeMoE](https://huggingface.co/blog/AviSoori1x/makemoe-from-scratch) | Refactoring | From-scratch Sparse MoE reference implementation |
| 5 | [opencouncil/whisper-large-v3-el-council-lora](https://huggingface.co/opencouncil/whisper-large-v3-el-council-lora) | Intake | Domain ASR (Greek council speech) |
| 6 | Unsloth Llama-3.1-8B Colab | Training | Fast LoRA/QLoRA fine-tuning of domain experts |

See `docs/SPARC_TURBOVEC_ARCHITECTURE.md` for the full pipeline.
