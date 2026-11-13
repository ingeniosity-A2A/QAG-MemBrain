# Salience-27B-R5 · Curation Profile

Canonical source: [hf://vectionlabs/Salience-27B-R5/README.md](https://huggingface.co/vectionlabs/Salience-27B-R5)
Pinned revision: `985cb1165f03b8ace35872ff02415b0f56e7824b`
License: Apache-2.0 · Base: Qwen3.8-27B · Architecture: Qwen3.5ForConditionalGeneration (image-text-to-text)
Vendor assets: 10 governable artifacts (5 tokenizer, 5 config) · 18 weight shards as remote refs (55.56 GB stayed vendor-side).

## Curation Decisions

| Decision | Value | Rationale |
| --- | --- | --- |
| Role in Exoskeleton | Substrate intelligence provider | Multimodal reasoning tier under Ava007 cognition; Ava007 identity stays independent |
| Weights residency | `vendor://remote/...` refs only | Spec §4: multi-GB weights never enter RocksDB or the vault |
| Skill surface | Curation configuration block below | Code chunks forge into RocksDB skills (spec §6 binding) |
| Context window | 262,144 tokens | Long-context document curation + repo-scale review |
| Vision routing | Enabled (image + video preprocessors vendored) | VLA and Beyond-The-Rainbow learning lanes may attach frames |

## Curation Configuration

```yaml
capability_id: cap_salience27b_curation_v1
model:
  repo_id: vectionlabs/Salience-27B-R5
  revision: 985cb1165f03b8ace35872ff02415b0f56e7824b
  vendor_class: remote_ref
inference:
  max_new_tokens: 2048
  temperature: 0.2
  top_p: 0.9
  context_window: 262144
curation_lanes:
  - manifesto_collection
  - beyond_the_rainbow_learning
  - vla
  - voice_audio_intelligence
escalation:
  to_ava007_when: confidence < 0.72 or safety_flag
```

## Boundaries

- Orchestration stays outside Ava007; Salience serves the Exoskeleton substrate.
- The vendor model does not become a Forged File by being used by a Capability — it remains an independently governed vendor asset.
- Execution is DEV-locked until the inference substrate is operational (see DEV-lock register).
