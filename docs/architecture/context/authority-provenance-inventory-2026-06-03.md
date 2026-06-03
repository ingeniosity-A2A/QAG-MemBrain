# Authority And Provenance Inventory - 2026-06-03

## Scope

This document is the architecture baseline snapshot before Sprint 12A external signatures.

It records what is implemented and validated through Sprint 11D.

## Sprint 1-11D Status

- Sprint 10A Replay Persistence: Completed
- Sprint 10A.1 Replay Integrity Proofs: Completed
- Sprint 10B Replay Graph Materialization: Completed
- Sprint 10C Governance Loader: Completed
- Sprint 10D Authority E2E: Completed
- Sprint 11A Governance Manifest: Completed
- Sprint 11A.1 Governance Attestation: Completed
- Sprint 11B Build Identity: Completed
- Sprint 11C Deployment Identity: Completed
- Governance Alignment 1.5: Completed
- Sprint 11D Runtime Identity: Completed

## Current Authority Chain

Cognitive authority chain:

JSONL -> Tashi -> Neo4j -> GSAP -> Runtime

Evidence:

- governance/ava007/AVA007_RUNTIME_GOVERNANCE.md
- authority/replay/replayContract.ts
- governance/manifest.json

## Current Provenance Chain

Provenance authority chain:

Governance -> Build -> Deployment -> Runtime -> Decision -> Lineage -> Replay -> Audit

Evidence:

- governance/ava007/AVA007_RUNTIME_GOVERNANCE.md
- authority/service/authorityReplayService.ts
- brain/executive/runtime.ts
- authority/service/replayRecord.ts
- audit/decisions/decisionRecord.ts

## Hash Sources

Governance hash sources:

- governance/manifest.json -> governance/manifest.hash
- governance/attestation.json -> governance/attestation.hash
- governance/loader/governanceLoader.ts computes package hash over governance/ava007

Build hash sources:

- authority/build/buildManifest.json -> authority/build/build.hash
- authority/build/buildLoader.ts verifies build hash and package version link

Deployment hash sources:

- authority/deployment/deploymentManifest.json -> authority/deployment/deployment.hash
- authority/deployment/deploymentLoader.ts verifies deployment hash and buildHash linkage

Runtime hash sources:

- authority/runtime/runtimeLoader.ts computes:
  - SHA256(deploymentHash + processId + hostname + startedAt)
- Runtime identity is startup-ephemeral and cached per process

Replay hash source:

- authority/persistence/replayHash.ts computes stable SHA256 over ReplayRecordInput payload
- authority/persistence/replayProof.ts seals and verifies replayHash

Decision hash source:

- lineage/hashing/decisionHash.ts is used by lineage construction and replay validation

## Persistence Layers

JSONL memory persistence:

- memory/ledger/jsonlLedger.ts append-only atom ledger and verification

Replay persistence:

- authority/replay/replay.jsonl
- authority/persistence/replayRepository.ts
- authority/persistence/replayLedger.ts
- authority/persistence/replaySchemas.ts
- authority/persistence/replayProof.ts

Governance artifact persistence:

- governance/manifest.json
- governance/manifest.hash
- governance/attestation.json
- governance/attestation.hash

Build artifact persistence:

- authority/build/buildManifest.json
- authority/build/build.hash

Deployment artifact persistence:

- authority/deployment/deploymentManifest.json
- authority/deployment/deployment.hash

## Graph Materialization

Replay graph materialization is implemented in authority/service/authorityReplayService.ts.

Materialized Replay node properties include:

- governanceVersion
- governanceHash
- manifestHash
- attestationHash
- runtimeVersion
- runtimeHash
- runtimeStartedAt
- runtimeHost
- runtimeProcessId
- runtimeNodeVersion
- runtimePlatform
- buildHash
- deploymentHash
- replayHash
- status and failureReasons

Materialized relationships:

- Decision -[REPLAYED]-> Replay
- Decision -[VERIFIED_BY]-> Replay
- Decision -[FAILED_BY]-> Replay

Neo4j repository implementations:

- graph/neo4j/repositories/cognitiveGraphRepository.ts (in-memory)
- graph/neo4j/repositories/neo4jGraphRepository.ts (Neo4j driver)

## Replay Guarantees

Deterministic replay and validation guarantees:

- authority/execution/authorityReplayEngine.ts
- authority/replay/replayValidator.ts
- authority/replay/replaySchema.ts
- authority/replay/replayReport.ts
- authority/replay/replayContract.ts

Replay guarantees currently enforced:

- hash reconstruction match
- policy outcome consistency
- reference existence checks
- immutable decisionId and lineageId checks
- canonical authority order checks
- deterministic failure reason emission
- sealed replay hash proof and tamper detection

## Audit Guarantees

Decision and replay audit guarantees:

- audit/decisions/decisionRecord.ts
- authority/execution/authorityReplayAudit.ts
- brain/executive/runtime.ts

Audit records now include provenance fields for:

- build identity
- deployment identity
- runtime identity

Runtime fields currently recorded include:

- runtimeHash
- runtimeStartedAt
- runtimeHost
- runtimeProcessId
- runtimeNodeVersion
- runtimePlatform

## Validation Evidence

Latest validation completed for this baseline:

- npm run build: passed
- npx vitest runtime and replay gate slice: passed
- npm test: passed
  - 42 test files passed
  - 1 test file skipped
  - 73 tests passed
  - 1 test skipped

Key gate tests in this phase:

- tests/authority/runtime.loader.test.ts
- tests/authority/runtime.provenance.test.ts
- tests/authority/replay.runtime.test.ts
- tests/authority/audit.runtime.test.ts
- tests/authority/authority.replay.e2e.test.ts
- tests/governance/governance.loader.test.ts

## Remaining Open Risks

- External signature verification is not yet implemented.
- Provenance chain remains internally verifiable but not externally attestable.
- Neo4j integration test is still optional/skipped unless external Neo4j env is configured.
- Governance artifacts are file-based and require controlled release discipline for version/hash rotations.

## Next Step Baseline

Sprint 12A target: external signature layer over replay artifacts.

Recommended focus:

- sign replayHash with signer identity and signing algorithm
- persist signature metadata with replay artifacts
- verify signature against replayHash and reject tampered hash
- include external verification checks in e2e path
