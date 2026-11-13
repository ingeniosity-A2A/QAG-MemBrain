# Qwen3.8-27B-TURBO NEO-CODER (GGUF) · Curation Profile

Canonical source: [hf://DavidAU/Qwen3.8-27B-TURBO-Fable-Cold-Fusion-735-882-Heretic-Uncensored-NEO-CODER-MAX-MTP-GGUF/README.md](https://huggingface.co/DavidAU/Qwen3.8-27B-TURBO-Fable-Cold-Fusion-735-882-Heretic-Uncensored-NEO-CODER-MAX-MTP-GGUF)
Pinned revision: `89230607b3708bc1efe174e8fd34d4b164476c88`
License: Apache-2.0 · Base: Qwen3.8-27B (DavidAU NM-DAU full-precision parent) · MTP + vision projector (mmproj)
Vendor assets: 0 local artifacts (GGUF embeds its own declared header/config) · 23 remote refs incl. mmproj (389 GB stayed vendor-side).

## Curation Decisions

| Decision | Value | Rationale |
| --- | --- | --- |
| Role in Exoskeleton | Code-genesis substrate skill | Heavy-lift code generation under Ava007 cognition; Ava007 identity stays independent |
| Weights residency | `vendor://remote/...` refs only | Spec §4: GGUF weights never enter RocksDB or the vault |
| Quant selection | Curate per task tier | Q4 for draft work, Q8/fp16 for final synthesis; selection is a curation decision, not a runtime guess |
| Skill surface | Curation configuration block below | Code chunks forge into RocksDB skills (spec §6 binding) |
| Uncensored weights | Guarded by capability permissions | `execute: false` safe-default holds; content policy handled by Ava007 governance, not the vendor |

## Curation Configuration

```yaml
capability_id: cap_neocoder27b_curation_v1
model:
  repo_id: DavidAU/Qwen3.8-27B-TURBO-Fable-Cold-Fusion-735-882-Heretic-Uncensored-NEO-CODER-MAX-MTP-GGUF
  revision: 89230607b3708bc1efe174e8fd34d4b164476c88
  vendor_class: remote_ref
  format: gguf
inference:
  context_window: 262144
  mtp_accept_drafts: true
  temperature: 0.25
  top_p: 0.95
curation_lanes:
  - manifesto_collection
  - realtime_creative_sandbox
coding_tiers:
  draft: Q4_K_M
  review: Q6_K
  synthesis: Q8_0
escalation:
  to_ava007_when: task_marks_identity_or_policy or confidence < 0.68
```

## Boundaries

- Orchestration stays outside Ava007; the NEO-CODER substrate serves the Exoskeleton.
- GGUF files remain vendor remote refs — a Capability consuming them does not forge them (spec §4).
- Execution is DEV-locked until the GGUF inference substrate is operational (see DEV-lock register).
