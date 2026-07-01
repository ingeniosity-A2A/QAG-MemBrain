# QAG-MemBrain + Ava007 Cross-Repo Audit Report

**Date:** 2026-07-01
**Auditor:** MiMo Claw (automated)
**Scope:** QAG-MemBrain (`mobile-runtime` branch) + Ava007 (`main` branch)
**Total files audited:** QAG-MemBrain: 605 | Ava007: 699 | Combined: 1,304

---

## Executive Summary

The codebase is **substantially ahead of the spec**. AMOS v2.8 section 19 marks several systems as "Stub" or "Partial" that are actually implemented. There are **format mismatches** in the ObservationProposal contract between repos, **Mercury 2 contradiction** in the forbidden list, and **multiple undocumented systems** built but never added to architecture docs.

| Category | Count |
|----------|-------|
| Verified DONE (code matches doc) | 16/16 |
| Spec understates reality (ahead of spec) | 5 systems |
| Cross-repo contract violations | 2 |
| Undocumented systems (built, not in docs) | 11+ |
| Mercury 2 contradiction | 1 (inconsistent between docs) |

---

## Phase 1: AMOS v2.8 Section 19 — Status Table Verification

### ✅ Items marked DONE — All verified present

| Component | Doc Status | File | Code Exists | Matches Doc |
|-----------|-----------|------|-------------|-------------|
| Repository consolidation | DONE | (merge commit) | ✅ | ✅ |
| Reconciliation manifest | DONE | `runtime-consolidation` branch | ✅ | ✅ |
| Mobile Runtime scaffolding | DONE | `mobile/capacitor/` | ✅ | ✅ |
| Meta Harness (TS + Rust) | DONE | `src/meta/MetaHarness.ts`, `rust/meta-harness/` | ✅ | ✅ |
| Constellation (TS + Rust) | DONE | `src/constellation/Router.ts`, `rust/constellation/` | ✅ | ✅ |
| EPOCH (TS) | DONE | `src/epoch/index.ts` (8 files) | ✅ | ✅ |
| Backend split (BackendExecutor) | DONE | `src/constellation/backends/BackendExecutor.ts` | ✅ | ✅ |
| MlcLlmBackend | DONE | `src/constellation/backends/MlcLlmBackend.ts` | ✅ | ✅ |
| WebLlmBackend | DONE | `src/constellation/backends/WebLlmBackend.ts` | ✅ | ✅ |
| LlamdropBackend | DONE | `src/constellation/backends/LlamdropBackend.ts` | ✅ | ✅ |
| CloudBackend | DONE | `src/constellation/backends/CloudBackend.ts` | ✅ | ✅ |
| GemmaBackend.ts | DONE | `src/constellation/backends/GemmaBackend.ts` | ✅ | ✅ |
| rust/gemma-bridge/ | DONE | `rust/gemma-bridge/src/lib.rs`, `llama_ffi.rs` | ✅ | ✅ |
| GemmaBridge.kt | DONE | `mobile/.../GemmaBridge.kt` | ✅ | ✅ |
| AMOS v2.8 spec | DONE | `docs/AMOS_v2.8_ARCHITECTURE.md` | ✅ | ✅ |
| Vulkan compute POC | DONE | `mobile/.../cpp/vulkan/` | ✅ | ✅ |

### ⚠️ Spec says "Stub" but code is AHEAD

| Component | Doc Status | Actual Status | Evidence |
|-----------|-----------|---------------|----------|
| **REV.IKE** | Stub (Phase 8) | **IMPLEMENTED** | 6 TS files in `src/subconscious/rev_ike/` + A2A handler + API route + Python bridge |
| **TASHI** | Partial | **Substantially Complete** | 29 files, 13 dirs: consensus, replay, vector, ledger, ingestion, checkpoints |
| **GSAP Temporal** | Stub (Phase 6) | **Substantially Complete** | 9 files, 8 dirs: replay, hashing, reconstruction, lineage, reports |
| **EPOCH** | Stub (Phase 7) | **Partial** | 8 files: AdaptiveLayout, AgentSandbox, AnimatedUI, FrameScheduler, FurnitureViewer |
| **GOOSE** | Stub (Phase 8) | **Partial** | executor.py + tool_dispatcher.py in `src/execution/goose/` |

### ❌ Items marked PENDING — Verified not implemented

| Component | Status | Notes |
|-----------|--------|-------|
| Pre-flight on dev machine | PENDING | No evidence found |
| Device setup | PARTIAL | Bootstrap script exists but no device config |
| First live boot | PENDING | No evidence |
| llama.cpp Vulkan integration real | PENDING | FFI stub exists, not wired end-to-end |
| Arrow zero-copy real | PENDING | JNI shim exists, SharedArrayBuffer not wired |
| NNAPI delegate integration | PENDING | Stub only |
| Phone integration | PENDING | `PhoneIntegration.ts` exists but is scaffolding |
| TASHI L1-L4 memory | PENDING | L1-L2 implemented, L3-L4 partial |
| GSAP temporal engine | PENDING | Structure exists, engine not wired |
| EPOCH presentation real | PENDING | Files exist, not production-ready |
| AVA007 executive loop | PENDING | Orchestrator stub exists |
| Meshrabiya mesh | PENDING | No WiFi Aware code found |
| Production hardening | ONGOING | Not started |

---

## Phase 1: Cross-Repo Contract Compliance

### ❌ ObservationProposal Format Mismatch

**Contract (DUAL_CONSCIOUSNESS_CONTRACT.md):**
```typescript
interface ObservationProposal {
  type: "observation_proposal";
  source: "REV.IKE";
  timestamp: number;
  content: {
    interpretation: string;
    pattern?: string;
    question?: string;
    alternative_framing?: string;
    proposed_memory_content?: any;
  };
  confidence?: number;
}
```

**QAG-MemBrain TS actual (`src/subconscious/rev_ike/observationProposal.ts`):**
```typescript
interface InterpretationObservationProposal {
  type: "observation";          // ❌ Should be "observation_proposal"
  source: "rev_ike_lens";       // ❌ Should be "REV.IKE"
  // Missing: timestamp
  // Missing: content object structure
  insight: string;              // Different field name
  confidence: number;
  observationCount: number;     // Extra field not in contract
  graphHash: string;            // Extra field not in contract
}
```

**Ava007 Python actual (`runtime/intellect/core/subconscious/observation_proposal.py`):**
```python
@dataclass
class ObservationProposal:
    id: str                     # Extra field
    intent: str                 # Extra field
    confidence: float           # ✅ Matches
    payload: dict               # Extra field
    anomaly: bool               # Extra field
    pattern: str                # Similar to contract
    insight: str                # Different from "interpretation"
    proposed_action: str        # Extra field
    off_prompt_context_key: Optional[str]  # Extra field
    philosophical_diagnosis: Optional[str] # Extra field
    strategic_advice: Optional[str]        # Extra field
    tactical_directive: Optional[str]      # Extra field
    mood_bias: Optional[list]              # Extra field
    intuition_signals: Optional[list]      # Extra field
    # Missing: timestamp, content object, type field, source field
```

**Verdict:** Neither implementation matches the contract. The Python version has 14 fields (vs 6 in contract). The TS version has wrong `type` and `source` values and missing `timestamp`.

### ✅ Ava007Adapter Import Path

```python
AVA007_ROOT = Path(__file__).resolve().parents[4] / "Ava007"
from runtime.intellect.core.subconscious.rev_ike_bridge import RevIkeBridge
```

**Verdict:** Path resolves correctly **if both repos are cloned as siblings** in the same parent directory. This is a fragile deployment assumption — works for dev, may break in production.

### ✅ Authority Order in Code

**QAG-MemBrain governance (`src/runtime/governance/replay/replayContract.ts`):**
```typescript
export const CANONICAL_AUTHORITY_ORDER: AuthorityLayer[] =
  ["JSONL", "Tashi", "Neo4j", "GSAP", "Runtime"];
```

**Governance loader validates at load time (`governanceLoader.ts:88-93`):**
```typescript
const authorityLayers: AuthorityLayer[] = ["JSONL", "Tashi", "Neo4j", "GSAP", "Runtime"];
// Throws if manifest doesn't match canonical order
```

**Verdict:** ✅ Authority order is enforced in code and validated at runtime.

### ⚠️ Ava007 Governance — Different System

Ava007's `runtime/intellect/core/safety/governance.py` uses an action-classification system (SAFE/ELEVATED/RESTRICTED/FORBIDDEN) rather than the authority-order chain. This is complementary, not conflicting, but it does NOT reference the JSONL > Tashi > Neo4j > GSAP > Runtime order.

---

## Phase 1: Mercury 2 Contradiction

**AMOS v2.8 Section 18 (Stripped):**
> `~~Mercury-2 model~~` — Not a real published model.
> `~~Mercury-2~~` — doesn't exist

**AVA007_UNIFIED_MEMORY_INTELLIGENCE_CONTRACT.md (Cloud Cortex section):**
> Model: Mercury2
> Responsibilities: [Cloud Cortex operations]

**Code (`src/core/ava007/mercury2.ts`, `mercury2SynthesisClient.ts`):**
> Both DeterministicMercury2Client and HttpMercury2Client exist
> HttpMercury2Client calls a real endpoint

**qag_integration.md (already noted):**
> "Mercury 2 by Inception Labs IS real. The forbidden reference was to a generic 'Mercury-2' name."

**Verdict:** The forbidden list entry is **stale/incorrect**. Mercury 2 by Inception Labs is real and used in code. Section 18 should be updated to clarify: "Mercury-2 (generic/unverified) — use Mercury 2 by Inception Labs instead."

---

## Phase 1: Undocumented Systems

Systems built in QAG-MemBrain but NOT in AMOS v2.8 or any architecture doc:

| System | Location | Files | Purpose |
|--------|----------|-------|---------|
| **Ava007 Adapter** | `src/execution/revike/ava007_adapter.py` | 1 | Cross-repo bridge to Ava007's Python Rev.Ike |
| **Mercury2 Client** | `src/core/ava007/mercury2.ts` | 1 | Deterministic + HTTP Mercury 2 clients |
| **Mercury2 Synthesis** | `src/core/ava007/executive/mercury2SynthesisClient.ts` | 1 | Philosophical diagnosis synthesis |
| **Gemma Query Transformer** | `src/core/ava007/reflex/gemmaQueryTransformer.ts` | 1 | Query transformation for Gemma |
| **VibeThinker Provider** | `src/core/inference/webllm/VibeThinkerProvider.ts` | 1 | VibeThinker-3B inference |
| **RevIke A2A Handler** | `src/a2a/handlers/revike_handler.py` | 1 | A2A protocol handler for Rev.Ike |
| **RevIke Retrieval Repo** | `src/graph/repositories/revikeRetrievalRepository.ts` | 1 | Graph-based memory retrieval for Rev.Ike |
| **GRPO Harness** | `src/training/grpo_harness.py`, `.ts` | 2 | Reinforcement learning training |
| **SIP Client** | `scripts/sip_client.py` | 1 | SIP telephony integration |
| **Orchestration Services** | `services/orchestration/` | 6 | memory_router, memory_policy, context_filter, task_memory_manager |
| **Phone Integration** | `src/telecom/PhoneIntegration.ts` | 1 | Android telephony scaffolding |
| **Telnyx Integration** | `src/telnyx/index.ts` | 1 | Telnyx telephony API |
| **Neo4j Enforcement** | `src/graph/neo4j/enforcement.ts` | 1 | Graph governance enforcement |
| **Graph Quantization** | `src/graph/quantization.ts` | 1 | Graph compression |

---

## Phase 2: Recommended Fixes

### Priority 1 — Contract Violations

1. **Standardize ObservationProposal format** across both repos to match `DUAL_CONSCIOUSNESS_CONTRACT.md`
   - QAG TS: Fix `type` → `"observation_proposal"`, `source` → `"REV.IKE"`, add `timestamp`, restructure `content`
   - Ava007 Python: Add `type`, `source`, `timestamp` fields; restructure to match contract `content` object

2. **Fix Mercury 2 forbidden list** in AMOS v2.8 section 18
   - Change: `~~Mercury-2 model~~ — Not a real published model`
   - To: `~~Mercury-2 (generic/unverified name)~~ — Use Mercury 2 by Inception Labs (real, verified)`

### Priority 2 — Spec Staleness

3. **Update AMOS v2.8 section 19** to reflect actual implementation status:
   - REV.IKE: Stub → Implemented
   - TASHI: Partial → Substantially Complete
   - GSAP Temporal: Stub → Substantially Complete
   - EPOCH: Stub → Partial
   - GOOSE: Stub → Partial

4. **Add undocumented systems** to architecture docs (at minimum: Ava007 Adapter, Mercury2, GRPO Harness, Orchestration Services)

### Priority 3 — Robustness

5. **Ava007Adapter import path** — document the sibling-directory requirement or add a fallback/env-var config

6. **Ava007 governance** — add explicit reference to authority order chain in Python governance module

---

## Phase 3: Verification Artifacts

- **This report:** `docs/AUDIT_REPORT.md`
- **Dashboard:** `docs/verification-dashboard.html`

---

*Audit completed: 2026-07-01 02:30 UTC*
*Repos: QAG-MemBrain@mobile-runtime (605 files), Ava007@main (699 files)*
