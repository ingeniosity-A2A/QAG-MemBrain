# ⚠️ This Repository Has Been Archived

**Archive Date:** July 2026
**Reason:** All useful logic ported to Ava007 (`ingeniosity-A2A/Ava007`)

---

## Where the Code Went

Every module with real, tested logic from QAG-MemBrain has been ported to Ava007's `runtime/lib/intellect/` directory, adapted to Ava007's vocabulary (Intent + Runtime Flow + resolution instead of Atom/CortexPacket/DagSlice).

### Ported (14 modules across 4 tiers)

| Tier | Module | Ava007 Location |
|---|---|---|
| **Tier 1** | Mercury 2 Client | `runtime/lib/intellect/tiers/mercury2.ts` |
| **Tier 1** | Mellum2 Client | `runtime/lib/intellect/tiers/mellum2.ts` |
| **Tier 1** | Escalation Gates | `runtime/lib/intellect/tiers/escalationGates.ts` |
| **Tier 1** | Dynamic Prompt Engine | `runtime/lib/intellect/tiers/dynamicPromptEngine.ts` |
| **Tier 2** | Vector Task Memory | `runtime/lib/intellect/memory/vectorTaskMemory.ts` |
| **Tier 2** | GraphRAG Context Retrieval | `runtime/lib/intellect/graph/graphRag.ts` |
| **Tier 2** | Query Transform (Gemma) | `runtime/lib/intellect/memory/queryTransform.ts` |
| **Tier 3** | S25 Ultra NPU Bridge | `runtime/lib/intellect/mobile/s25NpuBridge.ts` |
| **Tier 3** | QNN Delegate | `runtime/lib/intellect/mobile/qnnDelegate.ts` |
| **Tier 3** | Zero-copy Tensors | `runtime/lib/intellect/mobile/zeroCopy.ts` |
| **Tier 3** | WebLLM Runtime | `runtime/lib/intellect/mobile/webllmRuntime.ts` |
| **Tier 4** | Tashi Consensus | `runtime/lib/intellect/authority/tashiConsensus.ts` |
| **Tier 4** | Atomic Memory + CFGL | `runtime/lib/intellect/authority/atomicMemory.ts` |
| **Tier 4** | Graph Reconstruction | `runtime/lib/intellect/authority/graphReconstruction.ts` |

### Audit Results

- **4 days** spent on audit + ports
- **~8 weeks** of rebuild work saved
- All 14 ports adapted to Ava007 vocabulary (no QAG-isms leaked through)
- Zero-SDK pattern applied throughout (every module has graceful fallback)
- Full L1-L6 authority chain per VOLUME-II now operational in Ava007

See `ingeniosity-A2A/Ava007/wiki/authority-chain-ports.md` for the complete audit summary.

### Not Ported (intentionally)

These QAG-MemBrain modules were redundant with existing Ava007 code or niche features:
- Brain (69 lines) — Ava007 has full `runtime/lib/brain.ts`
- Cognition (3-line stub) — empty
- HAL (46 lines) — subsumed by S25UltraNPUBridge
- Vast Tripo Driver (782 lines) — niche 3D feature, not Phase 3 priority
- Ava007 Orchestrator (TS) — Exoskeleton substrate is leaner
- Agent Router — Exoskeleton covers same need
- Subconscious Rev.Ike (TS version) — Python version already integrated in Ava007
- Griptape Ava007 Runtime (Python) — reference only
- Telecom — Ava007 has Telnyx/Twilio directly wired
- Contract Enforcement — Ava007 has `enforce.ts` + `audit.ts`

---

## Do Not Open New Issues or PRs Here

This repository is now **read-only**. All future development happens in:
- **Ava007** (`ingeniosity-A2A/Ava007`) — the platform
- **Agent-X** (`ingeniosity-A2A/Agent-X`) — Help Assembly Services
- **Core-Membrain** (`ingeniosity-A2A/Core-Membrain`) — v3.0 Rust workspace spec

For questions about ported code, open an issue in Ava007 and reference this repo.

---

## Cloning for Historical Reference

This repo remains cloneable for historical reference:

```bash
git clone https://github.com/ingeniosity-A2A/QAG-MemBrain.git
```

But no new commits will be accepted. The `main` branch is frozen at the archive point.
