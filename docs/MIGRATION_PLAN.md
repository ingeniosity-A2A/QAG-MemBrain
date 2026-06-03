# Migration Plan - Legacy to QAG_MemBrain

## Goals
- Extract memory and cognition code from legacy repositories into QAG_MemBrain.
- Archive legacy repos as read-only.
- Ensure no active development for core architecture outside QAG_MemBrain.
- Update surface packages to consume the new API.

## Phase 0 - Preparation (1 day)
1. Create repository structure defined in the charter.
2. Set branch protection rules (main protected, signed commits required).
3. Copy documentation from legacy repos into docs/archive.
4. Define JSONL master schema as single source of truth.

## Phase 1 - Extract Memory Layer (3 days)
| Legacy Component | Destination |
|------------------|-------------|
| JSONL schema definition | /memory/jsonl/schema.ts |
| JSONL read/write utilities | /memory/jsonl/io.ts |
| Audit log code | /memory/audit/auditLogger.ts |
| Learning/cortex outputs | /memory/learning/cortex-updates.jsonl |

Validation: write memory, restart service, read back identical data.

## Phase 2 - Integrate Tashi (2 days)
- Move Rust tashi sidecar into /tashi.
- Update orchestrators to call Tashi over HTTP.
- Validate offline queue at /tashi/gossip/queue.jsonl without connectivity.

## Phase 3 - Port GSAP Temporal Substrate (4 days)
- Isolate pure temporal orchestration from rendering.
- Move temporal code into /temporal/gsap.
- Implement JSONL-to-tween serializer in /temporal/serialization.
- Add deterministic replay tests.

## Phase 4 - Dual Brain Integration (2 days)
- Reflex writes JSONL to same ledger.
- Executive cloud functions call QAG_MemBrain API.
- Cortex learning scripts move to /memory/learning.

## Phase 5 - API Layer (2 days)
- Implement REST plus WebSocket API in /interfaces/api.
- Implement SDKs in /interfaces/sdk.
- Validate with a CLI consumer.

## Phase 6 - Archive and Switchover (1 day)
- Move legacy repos into /archive/legacy-repos.
- Update surfaces to use membrain SDK.
- Set legacy repos to read-only.
- Run integration test: NFC tap -> JSONL -> Tashi -> GSAP -> recall -> API consumer update.

## Rollback Plan
1. Surfaces temporarily fall back to legacy APIs.
2. Revert QAG_MemBrain to last known good commit.
3. Un-archive legacy repos only for emergency hotfixes.

## Success Definition
- [ ] All memory/cognition code resides in QAG_MemBrain.
- [ ] Legacy repos archived with no active branches.
- [ ] Surface packages run against QAG_MemBrain API.
- [ ] Deterministic replay test passes.
- [ ] Offline Tashi queue test passes.
- [ ] No UI code inside QAG_MemBrain.

## Owner and Timeline
- Owner: Architecture lead
- Timeline: 2 weeks from approval
- Review gates: after Phase 2, Phase 4, and Phase 6
