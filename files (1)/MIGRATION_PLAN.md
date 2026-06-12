# QAG_MemBrain — Migration Plan

Migration from legacy repositories (AVA007, AvaPy, Ingeniosity, and related)
into the canonical QAG_MemBrain structure.

---

## Goals

- Extract all memory and cognition code from legacy repositories into QAG_MemBrain
- Archive legacy repos as read-only references — no active branches
- Update surface packages to consume the Consumption API instead of direct legacy access
- Enforce the boundary: QAG_MemBrain owns cognition, surfaces own presentation

---

## What is NOT migrated

The following stay outside QAG_MemBrain permanently:

- Three.js scene setup and spatial canvas code → `ava-runtime`
- Chat UI, weather display, docking station visuals → `ava-surface`
- Opera Air configuration → `ava-surface`
- Audio rendering and sonification → `ava-runtime`
- Any file that imports a DOM API or renders pixels

---

## Phase 0 — Foundation (Day 1)

**Actions**
1. Create the QAG_MemBrain repository with the directory structure from the charter
2. Add `REPOSITORY_CHARTER.md`, `CONSUMPTION_API.md`, and this file to `main`
3. Enable branch protection on `main` — require signed commits, require passing tests
4. Copy all whitepapers and architecture docs from legacy repos into `/docs/architecture/`
5. Declare the JSONL master schema (from the Ingestion Engine spec) as the single source of truth in `/memory/jsonl/schema.ts`

**Exit criteria**
- Repository exists with complete directory skeleton
- Charter and API docs committed and reviewed
- JSONL schema locked and documented

---

## Phase 1 — Memory Layer (Days 2–4)

**What moves**

| Legacy source | Destination in QAG_MemBrain |
|---------------|----------------------------|
| JSONL schema definitions | `/memory/jsonl/schema.ts` |
| Atom read/write utilities | `/memory/jsonl/io.ts` + `/memory/jsonl/io.py` |
| SHA-256 fingerprint + Ed25519 signing logic | `/memory/jsonl/signing.ts` |
| Audit log writers | `/memory/audit/audit_logger.ts` |
| Learning/policy output files | `/memory/learning/` |
| Embedding field generation | `/retrieval/embeddings/` |

**Validation test**
Write a memory atom, restart the service cold, read it back.
Atom content, hash, and signature must be byte-identical.

**Exit criteria**
- Cold-restart read-back test passes
- All write paths produce valid Ed25519 signatures
- No legacy database is written to directly from this layer

---

## Phase 2 — Tashi DAG (Days 5–6)

**What moves**

| Legacy source | Destination |
|---------------|-------------|
| Rust `tashi-vertex-rs` sidecar | `/tashi/dag/` (as submodule or compiled binary) |
| Gossip transport (WebRTC/WebSocket) | `/tashi/gossip/` |
| Offline queue logic | `/tashi/consensus/offline_queue.ts` |
| Peer discovery and NAT punching | `/tashi/gossip/peer_discovery.rs` |

**Key constraint**
Each vertex must reference a parent hash from `/memory/jsonl`.
The DAG must reject orphaned vertices (no valid parent hash).

**Validation test**
- Bring two nodes online, append vertices, disconnect one, append more, reconnect.
- All vertices must appear on both nodes. No data loss. No duplicate vertices.

**Exit criteria**
- Offline queue test passes
- Vertex signature verification passes on both nodes
- Parent hash chain is unbroken from genesis

---

## Phase 3 — GSAP Temporal Substrate (Days 7–10)

This phase has the most legacy entanglement. GSAP code in prior repos mixed
DOM rendering with state orchestration. The migration separates them.

**Rule:** If a line of code calls `document`, `window`, `canvas`, or any browser API,
it does not move to QAG_MemBrain. It stays in `ava-runtime`.

**What moves**

| Legacy source | Destination |
|---------------|-------------|
| `gsap.to(stateObject, ...)` calls on plain objects | `/temporal/gsap/timelineOrchestrator.ts` |
| Timeline serialization to JSONL | `/temporal/serialization/tweenToJsonl.ts` |
| Timeline deserialization from JSONL | `/temporal/serialization/jsonlToTween.ts` |
| Branch/counterfactual timeline logic | `/temporal/timeline/branch.ts` |
| Replay engine | `/temporal/timeline/replay.ts` |

**What stays in `ava-runtime`**

| Code | Reason |
|------|--------|
| `gsap.to(mesh.position, ...)` | DOM/Three.js dependency |
| `gsap.to(audioNode.gain, ...)` | Audio API dependency |
| Any canvas or WebGL calls | Rendering — not cognition |

**Determinism guarantee**
The replay engine must satisfy: `replay(timeline, t0) === replay(timeline, t0)` for any `t0`.
This is tested in `/tests/integration/deterministic_replay.test.ts`.

**Exit criteria**
- Deterministic replay test passes with 1000 iterations
- No DOM imports in `/temporal/`
- `gsap` is a dev dependency scoped only to temporal orchestration, not rendering

---

## Phase 4 — Dual Brain Integration (Days 11–12)

**What moves**

| Component | Current location | Destination |
|-----------|-----------------|-------------|
| Reflex layer (on-device model calls) | Termux/ava.py | `/brain/reflex/` |
| Executive layer (Mellum2 routing) | Cloud functions | `/brain/executive/` |
| Cortex layer (Mercury 2 / Ava007) | Scattered | `/brain/cortex/` |
| Escalation gate logic | Undocumented | `/brain/executive/escalation_gates.ts` |
| Confidence threshold config | Hardcoded | `/brain/executive/gate_config.json` |

**Escalation gate config (initial values)**
```json
{
  "reflex_pass_threshold": 0.85,
  "executive_pass_threshold": 0.60,
  "importance_auto_escalate": ["critical"],
  "known_reflex_types": ["nfc_tap", "a2a_post", "webhook_known"]
}
```

These values are updated by the cortex learning loop and written back to the audit log.

**Exit criteria**
- Reflex handles ≥70% of test atoms without escalation
- Executive handles ≥25% with correct sub-agent delegation
- Cortex receives ≤5% and produces correct policy outputs
- All three tiers write to the audit log with `brain_tier` field populated

---

## Phase 5 — API and SDK Layer (Days 13–14)

**Actions**
1. Implement the REST + WebSocket endpoints from `CONSUMPTION_API.md` in `/interfaces/api/`
2. Build TypeScript SDK in `/interfaces/sdk/ts/`
3. Build Python SDK in `/interfaces/sdk/python/`
4. Write API contract tests in `/tests/integration/api_contract.test.ts`

**Surface package update**
Once the SDK is published, update `ava-surface` to replace all direct legacy DB calls
with `MemBrainClient` calls. The surface should have zero direct JSONL file access.

**Exit criteria**
- All five endpoints respond correctly to SDK calls
- API contract tests pass
- `ava-surface` builds and runs against the new API without the legacy DB connection

---

## Phase 6 — Archive and Switchover (Day 15)

**Actions**
1. Move legacy repositories to `/archive/legacy-references/` (shallow clone or tarball)
2. Set all legacy repos to archived (read-only) on GitHub
3. Remove legacy repos from any CI/CD pipelines
4. Run the full end-to-end integration test:
   `NFC tap → JSONL → Tashi → GSAP → recall → API → ava-surface renders`
5. Announce switchover to all contributors

**Rollback plan**
- Surface packages retain the legacy connection string in environment variables for 30 days
- If a critical bug is found, surfaces can re-enable the legacy connection without a deploy
- QAG_MemBrain can be rolled back by git revert — all state is in JSONL and is durable
- Legacy repos remain accessible as archives — unarchiving requires explicit approval

---

## Full Integration Test

The following test must pass before Phase 6 is declared complete.
It has no UI dependency — it runs entirely in the test harness.

```
1. Write NFC tap atom via POST /memory
2. Assert vertex hash returned and vertex appears in Tashi DAG
3. Assert GSAP tween atom created and inserted into timeline
4. Recall state at ingestion timestamp via GET /recall
5. Assert state fields match expected values
6. Assert audit log entry contains brain_tier, model_used, latency_ms
7. Disconnect Tashi node, write 10 more atoms offline
8. Reconnect — assert all 10 atoms appear in DAG, no data loss
9. Assert deterministic replay: recall(t) called twice returns identical state
```

All assertions must pass with zero flakiness across 10 consecutive runs.

---

## Timeline Summary

| Phase | Days | Exit criteria |
|-------|------|---------------|
| 0 — Foundation | 1 | Repo skeleton + charter committed |
| 1 — Memory Layer | 2–4 | Cold-restart read-back passes |
| 2 — Tashi DAG | 5–6 | Offline queue test passes |
| 3 — GSAP Temporal | 7–10 | Deterministic replay passes |
| 4 — Dual Brain | 11–12 | Escalation ratios within spec |
| 5 — API + SDK | 13–14 | Contract tests pass |
| 6 — Archive + Switchover | 15 | Full integration test passes |

**Total: 15 working days from Phase 0 start.**
