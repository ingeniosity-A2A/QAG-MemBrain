# Nemotron-Labs-Audex-30B-A3B · Curation Profile

Canonical source: [hf://nvidia/Nemotron-Labs-Audex-30B-A3B/README.md](https://huggingface.co/nvidia/Nemotron-Labs-Audex-30B-A3B)
Pinned revision: `4e7e342045736382ddf3e2952c313847a08642b8`
License: other (NVIDIA noncommercial — governable use only, no commercial deployment) · 30B-A3B MoE · transformers `trust_remote_code`
Vendor assets: 51 governable artifacts (modeling/config `.py` source, nested checkpoint configs, tokenizers, chat templates) · 17 remote refs (71.6 GB stayed vendor-side) · check-point folders: full / audiogen / textonly / speech decoder / VAE enhancer.

## Curation Decisions

| Decision | Value | Rationale |
| --- | --- | --- |
| Role in Exoskeleton | Voice/Audio Intelligence lane | The designated audio substrate under Ava007 cognition |
| Modality coverage | ASR · S2S · TTS · audio-QA · text-to-audio · 48k enhancement | Full audio arc: hear, understand, answer, speak, generate, clean |
| Vendor source code | 36 `.py` files vendored as `source` assets | trust_remote_code requires the modeling files; pinned by sha256 in the vendor store |
| License governance | Noncommercial — DEV-locked execution | Capability permissions stay `execute: false` until usage review |
| Weights residency | `vendor://remote/...` refs only | Spec §4: multi-GB weights never enter RocksDB or the vault |
| Skill surface | Curation configuration block below | Code chunks forge into RocksDB skills (spec §6 binding) |

## Curation Configuration

```yaml
capability_id: cap_audex30b_curation_v1
model:
  repo_id: nvidia/Nemotron-Labs-Audex-30B-A3B
  revision: 4e7e342045736382ddf3e2952c313847a08642b8
  vendor_class: remote_ref
  trust_remote_code: true
  license: noncommercial_review_required
inference:
  sample_rate: 48000
  streaming: true
  tasks:
    - asr
    - speech_to_speech
    - tts
    - audio_qa
    - text_to_audio
    - enhancement_48k
curation_lanes:
  - voice_audio_intelligence
  - manifesto_collection
escalation:
  to_ava007_when: speaker_identity_detected or license_scope_uncertain
```

## Boundaries

- Orchestration stays outside Ava007; Audex serves the Voice/Audio Intelligence lane of the Exoskeleton.
- The vendored modeling `.py` files are governed vendor `source` assets — they are not Forged Files and never enter F0→F3.
- Noncommercial license: execution is DEV-locked pending a usage-scope review (see DEV-lock register).
