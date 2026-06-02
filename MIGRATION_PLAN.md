# Migration Plan – Legacy to QAG_MemBrain

## Goals
- Extract all memory/cognition code from legacy repositories (`AVA007`, `AvaPy`, `Ingeniosity`, etc.) into `QAG_MemBrain`.
- Archive legacy repos as read‑only.
- Ensure no active development continues outside `QAG_MemBrain` for core architecture.
- Update surface packages to consume the new API.

## Phase 0 – Preparation (1 day)
1. Create `QAG_MemBrain` repository with the structure defined in the charter.
2. Set up branch protection rules (main = protected, require signed commits).
3. Copy all documentation from legacy repos into `/docs/archive/` (preserve history).
4. Define the JSONL master schema (from whitepapers) as the single source of truth.

## Phase 1 – Extract Memory Layer (3 days)
| Legacy Component | Destination |
|------------------|-------------|
| JSONL schema definition | `/memory/jsonl/schema.ts` |
| JSONL read/write utilities | `/memory/jsonl/io.py` (or `.ts`) |
| Audit log code | `/memory/audit/audit_logger.rs` |
| Learning / cortex outputs | `/memory/learning/cortex_updates.jsonl` |

**Validation:** After migration, a simple test writes a memory, restarts the service, and reads it back – must be identical.

## Phase 2 – Integrate Tashi (2 days)
- Take the Rust `tashi-vertex-rs` sidecar from the legacy `Tashi Mesh Ava007membrain` spec.
- Place it in `/tashi/dag/` as a compiled binary or submodule.
- Update the Python/Node orchestrator to call Tashi via HTTP (as in `ava.py`).
- Ensure the offline queue (`/tashi/gossip/queue.jsonl`) works without connectivity.

## Phase 3 – Port GSAP Temporal Substrate (4 days)
- Identify all GSAP timeline code from legacy UI experiments.
- Separate pure temporal orchestration from rendering:
  - Keep only `gsap.to(stateObject, ...)` that doesn't touch DOM.
  - Move to `/temporal/gsap/timelineOrchestrator.ts`.
- Implement `jsonlToTweenAtom()` serializer in `/temporal/serialization/`.
- Write deterministic replay tests.

## Phase 4 – Dual Brain Integration (2 days)
- Reflex layer (Gemma on‑device) already runs in Termux – ensure it writes JSONL to the same ledger.
- Executive layer (Watsonx) – rewrite cloud functions to call QAG_MemBrain API instead of directly accessing legacy DBs.
- Cortex layer – move learning scripts to `/memory/learning/`, scheduled via cron or event trigger.

## Phase 5 – API Layer (2 days)
- Implement the REST + WebSocket API described in `CONSUMPTION_API.md` inside `/interfaces/api/`.
- Write SDKs in `/interfaces/sdk/`.
- Test with a dummy surface (e.g., a simple CLI that consumes memories).

## Phase 6 – Archive & Switchover (1 day)
- Move all legacy repositories into `/archive/legacy-repos/` (shallow clone or tarball).
- Update surface repositories to import `@ava-007/membrain-sdk` and call `QAG_MemBrain` endpoints.
- Set legacy repos to read‑only on GitHub (archived).
- Run full integration test: NFC tap → JSONL → Tashi → GSAP → recall → UI updates via API.

## Rollback Plan
If critical bugs are found:
1. Surface packages can temporarily fall back to legacy APIs (still running).
2. `QAG_MemBrain` can be reverted to last known good commit.
3. Legacy repos can be un‑archived (read‑only flag removed) only for emergency hotfixes.

## Success Definition
- [ ] All memory/cognition code resides in `QAG_MemBrain`.
- [ ] Legacy repos archived, no active branches.
- [ ] Surface packages build and run against `QAG_MemBrain` API.
- [ ] Deterministic replay test passes.
- [ ] Offline Tashi queue test passes.
- [ ] No UI code inside `QAG_MemBrain`.

## Owner & Timeline
- Owner: Architecture lead
- Timeline: 2 weeks from approval
- Review gates after Phase 2, Phase 4, and Phase 6.
