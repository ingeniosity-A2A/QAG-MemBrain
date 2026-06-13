# QAG-MemBrain Repo Restructure — Migration Plan

> Generated: 2026-03-04  
> Status: **DRAFT — awaiting approval before execution**

---

## 0. Current State Analysis

### 0.1 Root-Level Inventory

| Type | Count | Details |
|------|-------|---------|
| Directories at root (excl. .git, node_modules, .github, .cloudflared) | **46** | 11 duplicate src/ modules, 24 root-only modules, 11 structural |
| Zip files at root | **8** | files (1).zip, files (2).zip, files (8).zip, files (9).zip, Griptape-more.zip, Latent-skill.zip, The integration point.zip, ava007-flagship-modules.zip |
| Loose root files | **8** | pipeline_impl.ts, git-ssh-wrapper.py, worklog.md, wrangler.toml, README.md, + 4 config files that stay |

### 0.2 Duplicates: root/ vs src/

**Key finding:** For all duplicate directories, root/ versions are **older iterations** and src/ versions are **canonical/current**. Files with the same name are **different** (root = v1 stubs, src/ = v2 with real imports). Per the rule, **src/ wins** — we merge only root-only files into src/.

| Root dir | Root-only files (not in src/) | src/ already has |
|----------|-------------------------------|------------------|
| `ava007/` | cortex/, executive/, orchestrator/, runtime/ (12 files), shared/ (2 files) | index.ts, orchestrator.ts, mercury2.ts, mellum2.ts, coordination_types.ts, query_transform.ts, escalation_gates.ts, gate_config.ts |
| `brain/` | ava007.ts, cortex/runtime.ts, executive/runtime.ts, reflex/runtime.ts, README.md | index.ts |
| `cognition/` | reflex/gemmaQueryTransformer.ts, executive/mercury2SynthesisClient.ts | index.ts, agent_router.ts, capability_manifest.ts, cognitive_state.ts, dev_harness.ts, dynamic_prompt_engine.ts, observation_types.ts, task_artifact_manager.ts |
| `consensus/` | tashi/consensus.ts | tashi/index.ts, tashi/signer.ts |
| `contract/` | *(none — root enforcement.ts is older version of src/contract/enforcement.ts)* | enforcement.ts, index.ts |
| `graph/` | neo4j/cypher/ (2), neo4j/graphrag/ (1), neo4j/repositories/ (3), neo4j/schema/ (2), neo4j/vector/ (1), reconstruction/ (4) | neo4j/index.ts, neo4j/enforcement.ts |
| `memory/` | jsonl/ (5 unique: hash.ts, memoryRecord.ts, jsonlStore.ts, provenance.ts, signatureVerification.ts, schema.json), ledger/ (1), atoms/ (1), replay/ (1), schemas/ (1), atomic_memory.ts, edge_customers.ts, task_memory_store.ts, vector_task_memory.ts | jsonl/index.ts, jsonl/store.ts, ingestion/index.ts, ingestion/pipeline.ts |
| `proximity/` | *(none — root protocols.ts is older version)* | index.ts, protocols.ts |
| `subconscious/` | rev_ike.ts | index.ts |
| `temporal/` | gsap/registerAllPlugins.ts, gsap_bridge/ (2 .py), serialization/ (2), timeline/types.ts, gsap_temporal.ts, lite_notebook_lm.ts, replay/replayEngine.ts | index.ts, replay.ts, gsap_replay.ts |
| `training/` | grpo_harness.py *(Python)* | grpo_harness.ts, index.ts |

### 0.3 Root-Only Directories (not in src/)

| Root dir | File count | Nature |
|----------|-----------|--------|
| `a2a/` | 4 py | Agent-to-agent protocol handlers |
| `accelerators/` | 1 ts | Fabric accelerator |
| `agents/` | 5 py | Goose executor, Revike runtime |
| `archive/` | 1 md + gitkeeps | Legacy reference archive |
| `audit/` | 1 ts | Decision audit records |
| `authority/` | 49+ ts/json/hash/jsonl | Authority stack: build, deployment, execution, persistence, replay, runtime, service, signing, verification |
| `bin/` | 1 ts | CLI entry point |
| `cortex/` | 2 ts | Spatial cortex modules |
| `download/` | 1 html | Downloaded HTML surface |
| `evaluation/` | 37+ ts/jsonl/json | Benchmark runners, judgment layers, memory judge |
| `files (1)/` | 13 md | Unzipped docs (duplicate of data/zips/) |
| `files (2)/` | 3 md | Unzipped docs (duplicate of data/zips/) |
| `fusion/` | 1 ts | Operator fusion |
| `goose/` | 1 py | Goose executor (duplicate of agents/goose/) |
| `governance/` | 31+ xml/ts/json/md/hash | Governance policies, assemblies, runtime configs |
| `griptape/` | 3 py | Griptape workflow harness |
| `interfaces/` | 9 ts/yaml | API server, routes, OpenAPI spec |
| `interpretation/` | 5 ts | Insight generation, pattern detection |
| `lineage/` | 6 ts | Decision lineage engine, hashing, replay |
| `orchestration/` | 6 py | Python orchestration: context filter, memory router, griptape workflow |
| `output/` | 12+ tsx/html/json | React chat surfaces, standalone HTML, API client |
| `policy/` | 6 ts | Policy engine, evaluation, precedence, registry |
| `processed_zip_contents/` | 16 md | Duplicate of files (1)/ and files (2)/ |
| `quantum/` | 1 ts | Interaction quantum |
| `retrieval/` | 3 ts/md | Neo4j graph retrieval, quantization |
| `review/` | 3 ts | Proposal review, decision, audit |
| `shared/` | 1 ts | Shared types |
| `swarm/` | 1 ino | ESP32 LoRa bridge (Arduino) |
| `tashi/` | 3 ts/proto/md | Tashi node, DAG vertex proto |
| `trust/` | 6 ts | DID registry, Merkle proofs, Tashi gossip/vertex, signer service |
| `upload/` | 5 jpg | Screenshot uploads |
| `test/` | 1 ts | Single test file (singular — different from tests/) |

### 0.4 data/zips/ Unique Contents (not already in repo)

| Zip extract | Unique files not in repo |
|-------------|--------------------------|
| `Griptape-more/` | griptape_harness.py (different from grpo_harness.py) |
| `Latent-skill/` | latent_skill.py |
| `The integration point/` | All 4 files are variants of existing code |
| `ava007-flagship-modules/` | TSX components — already in output/surfaces/ |
| `files (10)/` | dual_brain.ts, pipeline.ts (variants) |

> **data/ is already .gitignored** — zip contents can remain as-is. No action needed for data/zips/.

---

## 1. Target Structure

```
src/                          # ALL application source code
  index.ts                    # single entry point (currently main.ts)
  pipeline.ts                 # from pipeline_impl.ts at root
  config.ts                   # typed config loader (NEW — needs creation)
  memory/                     # retrieval, temporal, subconscious
    retrieval/                # ← from root retrieval/
    temporal/                 # ← from src/temporal/ + root temporal/ unique files
    subconscious/             # ← from src/subconscious/ + root subconscious/ unique files
    jsonl/                    # ← merge root memory/jsonl/ unique files into src/memory/jsonl/
    ingestion/                # ← already in src/memory/
    ledger/                   # ← from root memory/ledger/
    atoms/                    # ← from root memory/atoms/
    replay/                   # ← from root memory/replay/
    schemas/                  # ← from root memory/schemas/
    atomic_memory.ts          # ← from root memory/
    edge_customers.ts         # ← from root memory/
    task_memory_store.ts      # ← from root memory/
    vector_task_memory.ts     # ← from root memory/
  agent/                      # ava007, cognition, brain, orchestration + agent infra
    ava007/                   # ← from src/ava007/ + root ava007/ unique files
    brain/                    # ← from src/brain/ + root brain/ unique files
    cognition/                # ← from src/cognition/ + root cognition/ unique files
    orchestration/            # ← from root orchestration/
    authority/                # ← from root authority/
    governance/               # ← from root governance/
    audit/                    # ← from root audit/
    cortex/                   # ← from root cortex/
    evaluation/               # ← from root evaluation/ (code only)
    fusion/                   # ← from root fusion/
    interpretation/           # ← from root interpretation/
    lineage/                  # ← from root lineage/
    policy/                   # ← from root policy/
    quantum/                  # ← from root quantum/
    review/                   # ← from root review/
    trust/                    # ← from root trust/
  integrations/               # telnyx, ws, hal/lora, cloudflare worker + external services
    telnyx/                   # ← from src/telnyx/
    ws/                       # ← from src/ws/
    hal/                      # ← from src/hal/
    api/                      # ← from root interfaces/
    surfaces/                 # ← from root output/surfaces/
    a2a/                      # ← from root a2a/
    agents/                   # ← from root agents/
    griptape/                 # ← from root griptape/
    goose/                    # ← from root goose/ (merged with agents/goose/)
    accelerators/             # ← from root accelerators/
    swarm/                    # ← from root swarm/
  shared/                     # types, utils, constants
    types.ts                  # ← from root shared/types.ts
  consensus/                  # ← from src/consensus/ + root consensus/ unique files
  contract/                   # ← from src/contract/ (already canonical)
  graph/                      # ← from src/graph/ + root graph/ unique files
  proximity/                  # ← from src/proximity/ (already canonical)
  audio/                      # ← from src/audio/ (already canonical)

tests/                        # mirrors src/ structure
  agent/                      # authority/, evaluation/, lineage/, policy/, governance/
  memory/                     # temporal, subconscious, jsonl
  integrations/               # api, ws
  unit/                       # existing unit tests
  integration/                # existing integration tests
  phase1/                     # existing phase1 tests
  cortex/                     # existing cortex tests

training/                     # model training scripts
  grpo_harness.py             # ← from root training/

scripts/                      # build, deploy, dev utilities
  ava007.ts                   # ← from root bin/
  git-ssh-wrapper.py          # ← from root
  termux_setup.sh             # ← already in scripts/
  sip_client.py               # ← already in scripts/
  start_gateway.sh            # ← already in scripts/
  repo_setup.sh               # ← already in scripts/

docs/                         # documentation & logs
  worklog.md                  # ← from root
  archive/                    # ← from root archive/
  # existing docs/ content stays

data/                         # .gitignored — zips, uploads, processed files
  uploads/                    # ← from root upload/ + download/
  zips/                       # ← already in data/zips/; root *.zip files move here

infra/                        # Dockerfile, docker-compose, cloudflared config
  cloudflared/                # ← from root .cloudflared/
  wrangler.toml               # ← from root
```

---

## 2. Migration Plan — Phased `git mv` Commands

### PHASE 0: Pre-flight (create target directories)

```bash
cd /home/z/my-project

# Create new top-level dirs
mkdir -p infra/cloudflared

# Create new src/ subdirectories
mkdir -p src/agent
mkdir -p src/integrations
mkdir -p src/shared
mkdir -p src/memory/retrieval
mkdir -p src/memory/temporal
mkdir -p src/memory/subconscious
mkdir -p src/memory/ledger
mkdir -p src/memory/atoms
mkdir -p src/memory/replay
mkdir -p src/memory/schemas

# Create new src/agent/ subdirectories  
mkdir -p src/agent/authority
mkdir -p src/agent/governance
mkdir -p src/agent/audit
mkdir -p src/agent/cortex
mkdir -p src/agent/evaluation
mkdir -p src/agent/fusion
mkdir -p src/agent/interpretation
mkdir -p src/agent/lineage
mkdir -p src/agent/orchestration
mkdir -p src/agent/policy
mkdir -p src/agent/quantum
mkdir -p src/agent/review
mkdir -p src/agent/trust

# Create new src/integrations/ subdirectories
mkdir -p src/integrations/api
mkdir -p src/integrations/surfaces
mkdir -p src/integrations/a2a
mkdir -p src/integrations/agents
mkdir -p src/integrations/griptape
mkdir -p src/integrations/goose
mkdir -p src/integrations/accelerators
mkdir -p src/integrations/swarm

# Create new tests/ subdirectories
mkdir -p tests/agent
mkdir -p tests/memory
mkdir -p tests/integrations

# Create data subdirectories
mkdir -p data/uploads
```

---

### PHASE 1: Reorganize existing src/ modules into target structure

> These moves the **canonical src/ modules** into their target positions.

```bash
# 1a. Move src/ava007/ → src/agent/ava007/
git mv src/ava007 src/agent/ava007

# 1b. Move src/brain/ → src/agent/brain/
git mv src/brain src/agent/brain

# 1c. Move src/cognition/ → src/agent/cognition/
git mv src/cognition src/agent/cognition

# 1d. Move src/temporal/ → src/memory/temporal/
git mv src/temporal src/memory/temporal

# 1e. Move src/subconscious/ → src/memory/subconscious/
git mv src/subconscious src/memory/subconscious

# 1f. Move src/telnyx/ → src/integrations/telnyx/
git mv src/telnyx src/integrations/telnyx

# 1g. Move src/ws/ → src/integrations/ws/
git mv src/ws src/integrations/ws

# 1h. Move src/hal/ → src/integrations/hal/
git mv src/hal src/integrations/hal

# 1i. Rename src/main.ts → src/index.ts
git mv src/main.ts src/index.ts

# 1j. Move root pipeline_impl.ts → src/pipeline.ts
git mv pipeline_impl.ts src/pipeline.ts
```

---

### PHASE 2: Merge root duplicate directories into src/ (unique files only)

> Root dirs that duplicate src/ — move only files NOT already in src/.

```bash
# 2a. ava007/ (root) — unique subdirectories → src/agent/ava007/
git mv ava007/cortex src/agent/ava007/cortex
git mv ava007/executive src/agent/ava007/executive
git mv ava007/orchestrator src/agent/ava007/orchestrator
git mv ava007/runtime src/agent/ava007/runtime
git mv ava007/shared src/agent/ava007/shared

# 2b. brain/ (root) — unique files → src/agent/brain/
git mv brain/ava007.ts src/agent/brain/ava007.ts
mkdir -p src/agent/brain/cortex src/agent/brain/executive src/agent/brain/reflex
git mv brain/cortex/runtime.ts src/agent/brain/cortex/runtime.ts
git mv brain/executive/runtime.ts src/agent/brain/executive/runtime.ts
git mv brain/reflex/runtime.ts src/agent/brain/reflex/runtime.ts
git mv brain/README.md src/agent/brain/README.md

# 2c. cognition/ (root) — unique subdirectories → src/agent/cognition/
mkdir -p src/agent/cognition/reflex src/agent/cognition/executive
git mv cognition/reflex/gemmaQueryTransformer.ts src/agent/cognition/reflex/gemmaQueryTransformer.ts
git mv cognition/executive/mercury2SynthesisClient.ts src/agent/cognition/executive/mercury2SynthesisClient.ts

# 2d. consensus/ (root) — unique file → src/consensus/tashi/
git mv consensus/tashi/consensus.ts src/consensus/tashi/consensus.ts

# 2e. graph/ (root) — unique subdirectories → src/graph/
git mv graph/neo4j/cypher src/graph/neo4j/cypher
git mv graph/neo4j/graphrag src/graph/neo4j/graphrag
git mv graph/neo4j/repositories src/graph/neo4j/repositories
git mv graph/neo4j/schema src/graph/neo4j/schema
git mv graph/neo4j/vector src/graph/neo4j/vector
git mv graph/reconstruction src/graph/reconstruction

# 2f. memory/ (root) — unique files → src/memory/
git mv memory/jsonl/hash.ts src/memory/jsonl/hash.ts
git mv memory/jsonl/memoryRecord.ts src/memory/jsonl/memoryRecord.ts
git mv memory/jsonl/provenance.ts src/memory/jsonl/provenance.ts
git mv memory/jsonl/signatureVerification.ts src/memory/jsonl/signatureVerification.ts
git mv memory/jsonl/schema.json src/memory/jsonl/schema.json
git mv memory/jsonl/jsonlStore.ts src/memory/jsonl/jsonlStore.ts
git mv memory/ledger src/memory/ledger
git mv memory/atoms src/memory/atoms
git mv memory/replay src/memory/replay
git mv memory/schemas src/memory/schemas
git mv memory/atomic_memory.ts src/memory/atomic_memory.ts
git mv memory/edge_customers.ts src/memory/edge_customers.ts
git mv memory/task_memory_store.ts src/memory/task_memory_store.ts
git mv memory/vector_task_memory.ts src/memory/vector_task_memory.ts
git mv memory/README.md src/memory/README.md

# 2g. temporal/ (root) — unique files → src/memory/temporal/
mkdir -p src/memory/temporal/gsap src/memory/temporal/gsap_bridge src/memory/temporal/serialization src/memory/temporal/timeline src/memory/temporal/replay
git mv temporal/gsap/registerAllPlugins.ts src/memory/temporal/gsap/registerAllPlugins.ts
git mv temporal/gsap_bridge/__init__.py src/memory/temporal/gsap_bridge/__init__.py
git mv temporal/gsap_bridge/timeline_bridge.py src/memory/temporal/gsap_bridge/timeline_bridge.py
git mv temporal/serialization/timelineSerialization.ts src/memory/temporal/serialization/timelineSerialization.ts
git mv temporal/serialization/timeline_schema.json src/memory/temporal/serialization/timeline_schema.json
git mv temporal/timeline/types.ts src/memory/temporal/timeline/types.ts
git mv temporal/gsap_temporal.ts src/memory/temporal/gsap_temporal.ts
git mv temporal/lite_notebook_lm.ts src/memory/temporal/lite_notebook_lm.ts
git mv temporal/replay/replayEngine.ts src/memory/temporal/replay/replayEngine.ts
git mv temporal/README.md src/memory/temporal/README.md

# 2h. subconscious/ (root) — unique file → src/memory/subconscious/
git mv subconscious/rev_ike.ts src/memory/subconscious/rev_ike.ts

# 2i. training/ (root) — Python file → training/ (not src/)
git mv training/grpo_harness.py training/grpo_harness.py

# 2j. proximity/ (root) — DUPLICATE, src/ is canonical. Skip.
# No files to move — root proximity/protocols.ts is older version of src/proximity/protocols.ts

# 2k. contract/ (root) — DUPLICATE, src/ is canonical. Skip.
# No files to move — root contract/enforcement.ts is older version of src/contract/enforcement.ts
```

---

### PHASE 3: Absorb root-only directories into src/

> Directories that exist ONLY at root, moved into the target structure.

```bash
# 3a. authority/ → src/agent/authority/
git mv authority/build src/agent/authority/build
git mv authority/deployment src/agent/authority/deployment
git mv authority/execution src/agent/authority/execution
git mv authority/persistence src/agent/authority/persistence
git mv authority/replay src/agent/authority/replay
git mv authority/runtime src/agent/authority/runtime
git mv authority/service src/agent/authority/service
git mv authority/signing src/agent/authority/signing
git mv authority/verification src/agent/authority/verification
# Note: authority/worklog.md → docs/
git mv authority/worklog.md docs/authority-worklog.md

# 3b. governance/ → src/agent/governance/
git mv governance/ava007 src/agent/governance/ava007
git mv governance/loader src/agent/governance/loader
git mv governance/manifest.json src/agent/governance/manifest.json
git mv governance/manifest.hash src/agent/governance/manifest.hash
git mv governance/attestation.json src/agent/governance/attestation.json
git mv governance/attestation.hash src/agent/governance/attestation.hash

# 3c. audit/ → src/agent/audit/
git mv audit/decisions src/agent/audit/decisions

# 3d. cortex/ → src/agent/cortex/
git mv cortex/spatial src/agent/cortex/spatial

# 3e. evaluation/ → src/agent/evaluation/
git mv evaluation/benchmark src/agent/evaluation/benchmark
git mv evaluation/capability src/agent/evaluation/capability
git mv evaluation/governance src/agent/evaluation/governance
git mv evaluation/judgment src/agent/evaluation/judgment
git mv evaluation/memoryJudge src/agent/evaluation/memoryJudge
git mv evaluation/operational src/agent/evaluation/operational
git mv evaluation/provenance src/agent/evaluation/provenance
git mv evaluation/reliability src/agent/evaluation/reliability
git mv evaluation/replayIntegrity src/agent/evaluation/replayIntegrity
git mv evaluation/reports src/agent/evaluation/reports
git mv evaluation/safety src/agent/evaluation/safety
git mv evaluation/shared src/agent/evaluation/shared
git mv evaluation/signature src/agent/evaluation/signature
git mv evaluation/runEvaluation.ts src/agent/evaluation/runEvaluation.ts
git mv evaluation/types.ts src/agent/evaluation/types.ts
# Evaluation result files (.jsonl, .json) → data/evaluation-results/
mkdir -p data/evaluation-results
git mv evaluation/capability-results.jsonl data/evaluation-results/
git mv evaluation/governance-results.jsonl data/evaluation-results/
git mv evaluation/judgment-results.jsonl data/evaluation-results/
git mv evaluation/operational-results.jsonl data/evaluation-results/
git mv evaluation/provenance-results.jsonl data/evaluation-results/
git mv evaluation/reliability-results.jsonl data/evaluation-results/
git mv evaluation/replay-integrity-results.jsonl data/evaluation-results/
git mv evaluation/safety-results.jsonl data/evaluation-results/
git mv evaluation/signature-results.jsonl data/evaluation-results/
git mv evaluation/evaluation-report.json data/evaluation-results/
git mv evaluation/evaluation-report.hash data/evaluation-results/
git mv evaluation/evaluation-report.signature data/evaluation-results/
git mv evaluation/memory-judge-report.json data/evaluation-results/
git mv evaluation/reconstruction-benchmark.full.json data/evaluation-results/
git mv evaluation/reconstruction-benchmark.quick.json data/evaluation-results/
git mv evaluation/reconstruction-benchmark.tiered.json data/evaluation-results/

# 3f. fusion/ → src/agent/fusion/
git mv fusion/operator_fusion.ts src/agent/fusion/operator_fusion.ts

# 3g. interpretation/ → src/agent/interpretation/
git mv interpretation/insightGenerator.ts src/agent/interpretation/insightGenerator.ts
git mv interpretation/lens.ts src/agent/interpretation/lens.ts
git mv interpretation/memoryReflection.ts src/agent/interpretation/memoryReflection.ts
git mv interpretation/observationProposal.ts src/agent/interpretation/observationProposal.ts
git mv interpretation/patternDetection.ts src/agent/interpretation/patternDetection.ts

# 3h. lineage/ → src/agent/lineage/
git mv lineage/engine src/agent/lineage/engine
git mv lineage/hashing src/agent/lineage/hashing
git mv lineage/reconstruction src/agent/lineage/reconstruction
git mv lineage/replay src/agent/lineage/replay
git mv lineage/reports src/agent/lineage/reports
git mv lineage/schemas src/agent/lineage/schemas

# 3i. orchestration/ → src/agent/orchestration/
git mv orchestration/__init__.py src/agent/orchestration/__init__.py
git mv orchestration/context_filter.py src/agent/orchestration/context_filter.py
git mv orchestration/griptape_workflow.py src/agent/orchestration/griptape_workflow.py
git mv orchestration/memory_policy.py src/agent/orchestration/memory_policy.py
git mv orchestration/memory_router.py src/agent/orchestration/memory_router.py
git mv orchestration/rulesets.py src/agent/orchestration/rulesets.py
git mv orchestration/task_memory_manager.py src/agent/orchestration/task_memory_manager.py

# 3j. policy/ → src/agent/policy/
git mv policy/engine src/agent/policy/engine
git mv policy/evaluation src/agent/policy/evaluation
git mv policy/precedence src/agent/policy/precedence
git mv policy/registry src/agent/policy/registry
git mv policy/reports src/agent/policy/reports
git mv policy/schemas src/agent/policy/schemas

# 3k. quantum/ → src/agent/quantum/
git mv quantum/interaction_quantum.ts src/agent/quantum/interaction_quantum.ts

# 3l. review/ → src/agent/review/
git mv review/proposalAudit.ts src/agent/review/proposalAudit.ts
git mv review/proposalDecision.ts src/agent/review/proposalDecision.ts
git mv review/proposalReview.ts src/agent/review/proposalReview.ts

# 3m. trust/ → src/agent/trust/
git mv trust/did src/agent/trust/did
git mv trust/merkle src/agent/trust/merkle
git mv trust/tashi src/agent/trust/tashi
git mv trust/verification src/agent/trust/verification

# 3n. retrieval/ → src/memory/retrieval/
git mv retrieval/neo4j_graph.ts src/memory/retrieval/neo4j_graph.ts
git mv retrieval/quantization.ts src/memory/retrieval/quantization.ts
git mv retrieval/README.md src/memory/retrieval/README.md

# 3o. interfaces/ → src/integrations/api/
git mv interfaces/api/server.ts src/integrations/api/server.ts
git mv interfaces/api/openapi.v1.yaml src/integrations/api/openapi.v1.yaml
git mv interfaces/api/ws src/integrations/api/ws
git mv interfaces/api/routes src/integrations/api/routes
git mv interfaces/README.md src/integrations/api/README.md

# 3p. output/surfaces/ → src/integrations/surfaces/
git mv output/surfaces/ava-chat-surface src/integrations/surfaces/ava-chat-surface
git mv output/surfaces/standalone src/integrations/surfaces/standalone
git mv output/surfaces/api-client.ts src/integrations/surfaces/api-client.ts
git mv output/verification-report.json data/evaluation-results/output-verification-report.json

# 3q. a2a/ → src/integrations/a2a/
git mv a2a/__init__.py src/integrations/a2a/__init__.py
git mv a2a/handlers src/integrations/a2a/handlers
git mv a2a/schemas src/integrations/a2a/schemas

# 3r. agents/ → src/integrations/agents/
git mv agents/goose src/integrations/agents/goose
git mv agents/revike src/integrations/agents/revike

# 3s. griptape/ → src/integrations/griptape/
git mv griptape/ava_007_runtime.py src/integrations/griptape/ava_007_runtime.py
git mv griptape/vast_tripo_driver.py src/integrations/griptape/vast_tripo_driver.py
git mv griptape/workflow.py src/integrations/griptape/workflow.py

# 3t. goose/ → src/integrations/goose/
git mv goose/executor.py src/integrations/goose/executor.py

# 3u. accelerators/ → src/integrations/accelerators/
git mv accelerators/fabric.ts src/integrations/accelerators/fabric.ts

# 3v. swarm/ → src/integrations/swarm/
git mv swarm/esp32 src/integrations/swarm/esp32

# 3w. shared/ → src/shared/
git mv shared/types.ts src/shared/types.ts

# 3x. tashi/ → src/consensus/tashi/ (merge unique files)
git mv tashi/tashi_node.ts src/consensus/tashi/tashi_node.ts
git mv tashi/dag src/consensus/tashi/dag
git mv tashi/README.md src/consensus/tashi/README.md
```

---

### PHASE 4: Consolidate loose root files

```bash
# 4a. pipeline_impl.ts → already moved in Phase 1j to src/pipeline.ts

# 4b. git-ssh-wrapper.py → scripts/
git mv git-ssh-wrapper.py scripts/git-ssh-wrapper.py

# 4c. worklog.md → docs/
git mv worklog.md docs/worklog.md

# 4d. wrangler.toml → infra/
git mv wrangler.toml infra/wrangler.toml

# 4e. Move .cloudflared/ → infra/cloudflared/
git mv .cloudflared/config.yml infra/cloudflared/config.yml

# 4f. bin/ava007.ts → scripts/
git mv bin/ava007.ts scripts/ava007.ts
```

---

### PHASE 5: Relocate tests

```bash
# 5a. test/ (singular) → tests/ (merge lone file)
git mv test/layers.test.ts tests/layers.test.ts

# 5b. tests/authority/ → tests/agent/authority/
git mv tests/authority tests/agent/authority

# 5c. tests/evaluation/ → tests/agent/evaluation/
git mv tests/evaluation tests/agent/evaluation

# 5d. tests/lineage/ → tests/agent/lineage/
git mv tests/lineage tests/agent/lineage

# 5e. tests/policy/ → tests/agent/policy/
git mv tests/policy tests/agent/policy

# 5f. tests/governance/ → tests/agent/governance/
git mv tests/governance tests/agent/governance

# 5g. tests/cortex/ → tests/agent/cortex/
git mv tests/cortex tests/agent/cortex

# 5h. tests/unit/ — update import paths later (Phase 7)
# tests/unit/ stays in place but paths need updating

# 5i. tests/integration/ — stays in place
# tests/integration/ stays in place but paths need updating

# 5j. tests/phase1/ — stays in place  
# tests/phase1/ stays in place but paths need updating

# 5k. tests/benchmark/ — stays in place
```

---

### PHASE 6: Move data, archives, and non-src items

```bash
# 6a. Move root zip files → data/zips/
git mv "Griptape-more.zip" data/zips/
git mv "Latent-skill.zip" data/zips/
git mv "The integration point.zip" data/zips/
git mv "ava007-flagship-modules.zip" data/zips/
git mv "files (1).zip" data/zips/
git mv "files (2).zip" data/zips/
git mv "files (8).zip" data/zips/
git mv "files (9).zip" data/zips/

# 6b. upload/ → data/uploads/
git mv upload/ data/uploads/screenshots

# 6c. download/ → data/uploads/
git mv download/ava-service-quote-beeper.html data/uploads/ava-service-quote-beeper.html

# 6d. archive/ → docs/archive/
git mv archive/README.md docs/archive/README.md

# 6e. processed_zip_contents/ → data/ (already gitignored)
# These are duplicates of files (1)/ and files (2)/ content
# Can be removed entirely since data/zips/ has the originals
rm -rf processed_zip_contents/

# 6f. files (1)/ and files (2)/ → data/ (already gitignored)
# These are unzipped duplicates already in data/zips/files (1)/ and data/zips/files (2)/
rm -rf "files (1)/" "files (2)/"
```

---

### PHASE 7: Cleanup empty directories and update imports

```bash
# 7a. Remove now-empty root directories (verify they're empty first!)
for d in ava007 brain cognition consensus contract graph memory proximity subconscious temporal training goose agents a2a accelerators audit authority bin cortex download evaluation fusion governance griptape interfaces interpretation lineage orchestration output policy quantum retrieval review shared swarm tashi trust upload archive; do
  if [ -d "$d" ] && [ -z "$(find "$d" -type f -not -name '.gitkeep')" ]; then
    echo "Removing empty dir: $d"
    rm -rf "$d"
  elif [ -d "$d" ]; then
    echo "WARNING: $d still has files:"
    find "$d" -type f -not -name '.gitkeep'
  fi
done

# 7b. Remove stale .gitkeep files from moved directories
find src/ tests/ -name '.gitkeep' -delete

# 7c. Update ALL import paths
# This is the most labor-intensive step. Every .ts file with relative imports
# that pointed to root-level modules must be updated.
# Key renames:
#   "../main"        → "../index"             (or adjusted relative path)
#   "../../memory"   → "../../memory"         (stays same if already in src/)
#   "../ava007"      → "../agent/ava007"      (if from src/ level)
#   "../brain"       → "../agent/brain"
#   "../cognition"   → "../agent/cognition"
#   "../temporal"    → "../memory/temporal"
#   "../subconscious" → "../memory/subconscious"
#   "../telnyx"      → "../integrations/telnyx"
#   "../ws"          → "../integrations/ws"
#   "../hal"         → "../integrations/hal"
#
# Also update tsconfig.json paths if any path aliases exist.
# Also update wrangler.toml main entry: "dist/src/ws/cloudflare-worker.js"
#   → "dist/src/integrations/ws/cloudflare-worker.js"

# 7d. Update package.json scripts if they reference old paths

# 7e. Create src/config.ts (typed config loader — NEW file)
# This is a net-new file, not a migration. Placeholder:
#   export const config = { ... } loaded from .env with zod/valibot validation
```

---

## 3. Summary Statistics

| Metric | Before | After |
|--------|--------|-------|
| Root-level directories | 46 | 8 (src, tests, training, scripts, docs, data, infra, skills) |
| Root-level .zip files | 8 | 0 |
| Root-level loose source files | 5 (pipeline_impl.ts, git-ssh-wrapper.py, worklog.md, wrangler.toml, bin/ava007.ts) | 0 |
| Duplicate directories (root + src/) | 11 | 0 |
| Duplicate code deleted | 0 | **0** (none — only moved) |

### What stays at root level after migration:
```
.env
.env.example
.gitignore
README.md
package.json
package-lock.json
bun.lock
tsconfig.json
src/           ← all source code
tests/         ← all tests
training/      ← training scripts
scripts/       ← utilities
docs/          ← documentation
data/          ← .gitignored data
infra/         ← infrastructure config
skills/        ← separate skill ecosystem (untouched)
node_modules/  ← dependencies
.github/       ← CI/CD
```

---

## 4. Risk Mitigation

1. **Never delete source code** — all moves use `git mv`, preserving history
2. **src/ is canonical** — where root/ and src/ files conflict, src/ version wins
3. **Import path breaks** — Phase 7c is critical; run `tsc --noEmit` after each phase to catch breakages
4. **skills/ is untouched** — the 60+ skill directories are a separate ecosystem and should not be moved
5. **data/ stays .gitignored** — evaluation results and zip contents moved to data/ won't bloat the repo
6. **Test in phases** — commit after each phase so rollback is `git revert`

---

## 5. Execution Order Recommendation

1. **Phase 0** → commit "chore: create target directory structure"
2. **Phase 1** → commit "refactor: reorganize src/ modules into target structure"
3. **Phase 2** → commit "refactor: merge root duplicate dirs into src/"
4. **Phase 3** → commit "refactor: absorb root-only dirs into src/"
5. **Phase 4** → commit "refactor: consolidate loose root files"
6. **Phase 5** → commit "refactor: reorganize tests to mirror src/"
7. **Phase 6** → commit "chore: move data/archives/zips to data/"
8. **Phase 7** → commit "fix: update import paths and clean up" (may span multiple commits)

Each phase should be followed by `tsc --noEmit` and `npm test` to verify nothing is broken.
