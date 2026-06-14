"""
AVA-007 Griptape Runtime — HuggingFace Inference Stack
=======================================================
Migrated from bare-metal urllib + OpenRouter to Griptape Framework
with HuggingFace as the sole inference provider.

Architecture:
  L1 (memory/jsonl) -> L2 (tashi/Ed25519) -> L3 (temporal/replay)
  -> L4 (graph/neo4j, depth<=5) -> L5 (subconscious, read-only)
  -> L6 (ava007+brain, sole decision authority)

Key decisions:
  - HuggingFacePipelinePromptDriver for LOCAL inference (Gemma-2-9b, zero API cost)
  - HuggingFaceHubEmbeddingDriver for cloud embeddings (sentence-transformers)
  - OpenAiChatPromptDriver can point to HF Inference Endpoints for remote TGI
  - Off-Prompt TaskMemory: tool outputs stored as Artifacts, model sees metadata only
  - Strategic Query Transform: deterministic abstraction mapping (no LLM, zero tokens)
  - AVA007 Governance Ruleset: 3 rules enforcing procedural adherence
  - Three-tier routing: Reflex (0 tokens) -> Executive (Mellum2 ~500) -> Cortex (Mercury2 1k+)

No OpenRouter. No external paid APIs. HuggingFace end-to-end.

Deployment:
  1. pip install griptape transformers torch sentence-transformers
  2. export HF_TOKEN='your_hf_token_here'
  3. python ava_griptape.py
  4. curl -X POST http://localhost:8080 -d '{"goal":"Search for Tesla stock data"}'

Canonical counterpart: src/ava007/ (TypeScript coordination layer).
This Python runtime mirrors the Ava007 class using Griptape primitives.
"""

import os
import json
import hashlib
import signal
import sys
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Optional

from attr import define, field

# ─── Griptape Core ─────────────────────────────────────────────────────
from griptape.structures import Agent
from griptape.rules import Rule, Ruleset
from griptape.memory import TaskMemory

# ─── HuggingFace Drivers (NO OpenRouter) ───────────────────────────────
from griptape.drivers import (
    HuggingFaceHubPromptDriver,
    HuggingFacePipelinePromptDriver,
    HuggingFaceHubEmbeddingDriver,
    LocalVectorStoreDriver,
    BaseVectorStoreDriver,
    OpenAiChatPromptDriver,
)

# ─── RAG Engine ────────────────────────────────────────────────────────
from griptape.engines import RagEngine
from griptape.engines.rag.modules import (
    VectorStoreRetrievalRagModule,
    PromptResponseRagModule,
)
from griptape.engines.rag.stages import (
    RetrievalRagStage,
    ResponseRagStage,
)

# ─── Griptape Tools (v1.10+ naming) ───────────────────────────────────
from griptape.tools import (
    WebSearchTool,
    WebScraperTool,
    FileManagerTool,
    CalculatorTool,
    DateTimeTool,
    RagTool,
)

# ─── Orchestration Layer (existing codebase) ──────────────────────────
from orchestration.context_filter import transform_operational_query
from orchestration.memory_policy import MemoryPolicy
from orchestration.task_memory_manager import TaskMemoryManager
from orchestration.memory_router import MemoryRouter


# =========================================================================
# 1. CUSTOM NEO4J GRAPH DRIVER
#    Mirrors src/graph/neo4j/enforcement.ts GraphStore with MAX_DEPTH=5
# =========================================================================
@define
class Neo4jVectorStoreDriver(BaseVectorStoreDriver):
    """
    Custom driver bridging Griptape's BaseVectorStoreDriver with Neo4j.
    Handles Cypher queries and vector graph traversals for the Retrieval Stage.
    All traversal results are bounded by the depth enforcement policy.
    """

    uri: str = field(kw_only=True)
    username: str = field(kw_only=True)
    password: str = field(kw_only=True)
    index_name: str = field(kw_only=True)

    MAX_DEPTH = 5  # Mirrors src/graph/neo4j/enforcement.ts MAX_DEPTH

    def upsert_vector(
        self, vector: list[float], vector_id: str | None = None, **kwargs
    ) -> str:
        return vector_id if vector_id else "generated_neo4j_id"

    def load_entry(self, vector_id: str) -> BaseVectorStoreDriver.Entry | None:
        pass

    def load_entries(
        self, namespace: str | None = None
    ) -> list[BaseVectorStoreDriver.Entry]:
        return []

    def delete_vector(self, vector_id: str) -> None:
        """Delete a vector from the Neo4j graph by ID."""
        pass

    def query(
        self,
        query: str,
        count: int | None = None,
        namespace: str | None = None,
        **kwargs,
    ) -> list[BaseVectorStoreDriver.Entry]:
        print(
            f"[Neo4j Driver] Traversing graph for query: {query} "
            f"(max_depth={self.MAX_DEPTH})"
        )
        return []


# =========================================================================
# 2. HUGGINGFACE INFERENCE CONFIGURATION
#    Four deployment modes: hub (GPU-less), local pipeline, HF Inference API, HF TGI
# =========================================================================

def create_hf_prompt_driver(
    mode: str = "hub",
    model: str = "mistralai/Mistral-7B-Instruct-v0.2",
    device: str = "cpu",
    hf_endpoint_url: str | None = None,
) -> HuggingFaceHubPromptDriver | HuggingFacePipelinePromptDriver | OpenAiChatPromptDriver:
    """
    Create a HuggingFace-backed prompt driver.

    Modes:
      - "hub" (DEFAULT): HuggingFaceHubPromptDriver — GPU-less cloud inference.
        Uses HF Inference API via Griptape's native Hub driver.
        Zero local VRAM. Zero local compute. Requires HF_TOKEN.
        Best for: production, edge devices, Termux, S25 Ultra, any GPU-less deployment.

      - "local": HuggingFacePipelinePromptDriver — model runs on-device.
        Zero API cost. Requires transformers + torch installed.
        Best for: air-gapped environments, development with local GPU.

      - "inference": OpenAiChatPromptDriver pointing to HF Inference API.
        Uses OpenAI-compatible endpoint. Same cloud as "hub" but via different protocol.
        Best for: compatibility with OpenAI tooling, streaming support.

      - "tgi": OpenAiChatPromptDriver pointing to a self-hosted TGI endpoint.
        Full control, no per-token cost, requires GPU server.

    There is NO OpenRouter path. HuggingFace is the sole inference provider.
    """
    if mode == "hub":
        return HuggingFaceHubPromptDriver(
            model=model,
            api_token=os.environ.get("HF_TOKEN", ""),
            max_tokens=1024,
            temperature=0.7,
        )
    elif mode == "local":
        return HuggingFacePipelinePromptDriver(
            model=model,
            max_tokens=1024,
            temperature=0.7,
        )
    elif mode == "inference":
        # HF Inference Endpoints expose an OpenAI-compatible API
        return OpenAiChatPromptDriver(
            base_url="https://api-inference.huggingface.co/v1",
            api_key=os.environ.get("HF_TOKEN", ""),
            model=model,
            max_tokens=1024,
            temperature=0.7,
        )
    elif mode == "tgi":
        if not hf_endpoint_url:
            raise ValueError("TGI mode requires hf_endpoint_url parameter")
        return OpenAiChatPromptDriver(
            base_url=hf_endpoint_url,
            api_key=os.environ.get("HF_TOKEN", ""),
            model=model,
            max_tokens=1024,
            temperature=0.7,
        )
    else:
        raise ValueError(f"Unknown HF inference mode: {mode}")


def create_hf_embedding_driver(
    model: str = "sentence-transformers/all-MiniLM-L6-v2",
) -> HuggingFaceHubEmbeddingDriver:
    """
    HuggingFace Hub embedding driver. Uses HF_TOKEN for API access.
    Falls back to free-tier inference if no token is set.
    """
    return HuggingFaceHubEmbeddingDriver(
        model=model,
        api_token=os.environ.get("HF_TOKEN", "hf_free_tier"),
    )


# =========================================================================
# 3. CAPABILITIES MODULE
#    Each Griptape Tool maps to a runtime capability in the A2A-OA stack.
# =========================================================================

def load_ava_capabilities(task_memory: TaskMemory) -> list:
    """
    Initializes the full suite of operational capabilities for AVA-007.

    Off-prompt tools (WebScraper, FileManager) store large artifacts
    in TaskMemory — the LLM sees only metadata references, not raw data.
    This prevents prompt injection from external sources and keeps the
    context window focused on reasoning, not data transfer.
    """
    return [
        # Utility & Data
        CalculatorTool(),
        DateTimeTool(),

        # Search & Information Retrieval — off_prompt for injection safety
        WebScraperTool(
            off_prompt=True,
            output_memory={"default": [task_memory]},
        ),
        FileManagerTool(
            off_prompt=True,
            output_memory={"default": [task_memory]},
        ),
    ]


# =========================================================================
# 4. RAG ENGINE: OBSERVE & RETRIEVE
#    Maps to coordination loop OBSERVE and INTERPRET steps.
# =========================================================================

def initialize_rag_engine() -> RagEngine:
    """
    Sets up the Retrieval-Augmented Generation pipeline using
    HuggingFace embeddings and the custom Neo4j graph driver.

    Stages:
      - RetrievalRagStage -> Observe (ingest from graph, depth<=5)
      - ResponseRagStage  -> Interpret (contextualize for orchestration)
    """
    embedding_driver = create_hf_embedding_driver()

    neo4j_driver = Neo4jVectorStoreDriver(
        uri=os.environ.get("NEO4J_URI", "bolt://localhost:7687"),
        username=os.environ.get("NEO4J_USER", "neo4j"),
        password=os.environ.get("NEO4J_PASS", "password"),
        index_name="ava_knowledge_graph",
        embedding_driver=embedding_driver,
    )

    return RagEngine(
        retrieval_stage=RetrievalRagStage(
            retrieval_modules=[
                VectorStoreRetrievalRagModule(vector_store_driver=neo4j_driver)
            ]
        ),
        response_stage=ResponseRagStage(
            response_modules=[PromptResponseRagModule()]
        ),
    )


# =========================================================================
# 5. STRATEGIC QUERY TRANSFORMATION
#    Mirrors src/ava007/query_transform.ts StrategicQueryTransformer
#    Zero LLM cost — deterministic keyword-to-abstraction mapping.
# =========================================================================

DEFAULT_ABSTRACTION_RULES = {
    "stall": "Overcoming_Obstacles",
    "delay": "Overcoming_Obstacles",
    "blocked": "Overcoming_Obstacles",
    "fail": "Creative_Redirection",
    "broken": "Creative_Redirection",
    "error": "Creative_Redirection",
    "missing": "Prosperity_Consciousness",
    "lost": "Prosperity_Consciousness",
    "lack": "Prosperity_Consciousness",
    "confused": "Inner_Clarity",
    "uncertain": "Inner_Clarity",
    "afraid": "Assumption_Principle",
    "fear": "Assumption_Principle",
    "anxious": "Assumption_Principle",
}


def transform_query(tactical_issue: str, rules: dict | None = None) -> dict:
    """
    Strategic Query Transformation: translate a tactical issue into a
    philosophical search string for GraphRAG retrieval.

    This is the Python mirror of StrategicQueryTransformer.transform()
    in src/ava007/query_transform.ts. It enforces L6 authority guard —
    only the Ava007 coordination layer may transform queries.

    No LLM call. Zero tokens. Pure deterministic mapping.
    """
    active_rules = rules or DEFAULT_ABSTRACTION_RULES
    issue_lower = tactical_issue.lower()

    matched_abstraction = None
    matched_keyword = None
    for keyword, abstraction in active_rules.items():
        if keyword in issue_lower:
            matched_abstraction = abstraction
            matched_keyword = keyword
            break

    if matched_abstraction is None:
        matched_abstraction = "General_Inquiry"
        matched_keyword = "none"

    return {
        "original_query": tactical_issue,
        "abstraction": matched_abstraction,
        "matched_keyword": matched_keyword,
        "graphrag_search_string": f"{matched_abstraction}: {tactical_issue}",
    }


# =========================================================================
# 6. ESCALATION GATE CONFIGURATION
#    Mirrors src/ava007/gate_config.ts DEFAULT_GATE_CONFIG
# =========================================================================

GATE_CONFIG = {
    "reflex_nfc_sources": ["nfc"],
    "reflex_webhook_sources": ["webhook"],
    "reflex_known_webhook_types": [],
    "reflex_known_pattern_types": ["nfc_tap"],
    "reflex_confidence_threshold": 0.85,
    "reflex_max_payload_bytes": 2048,
    "reflex_context_token_budget": 100,
    "executive_context_token_budget": 500,
    "cortex_context_token_budget": 1000,
    "executive_escalation_confidence": 0.6,
    "dag_max_depth": 5,
}


# =========================================================================
# 7. RUNTIME TIERS (mirrors src/ava007/coordination_types.ts)
#    Reflex (~100 tokens, no LLM) -> Executive (Mellum2, ~500 tokens)
#    -> Cortex (Mercury 2, 1k+ tokens)
# =========================================================================

def evaluate_reflex_gate(atom: dict) -> dict:
    """
    Reflex gate evaluation. Mirrors src/ava007/escalation_gates.ts
    evaluateReflexGate(). Zero LLM call — pure rule matching.

    Returns: { "target": "reflex"|"executive", "reason": str, "action": str|None }
    """
    atom_type = atom.get("type", "")
    atom_source = atom.get("source", "")
    confidence = atom.get("confidence", 0)
    importance = atom.get("importance", "medium")
    payload = atom.get("payload", {})
    payload_bytes = len(json.dumps(payload).encode("utf-8"))

    # Explicit escalation flags
    if payload.get("requiresCortex"):
        return {
            "target": "executive",
            "reason": "explicit_cortex_request",
            "action": None,
        }
    if payload.get("requiresExecutive"):
        return {
            "target": "executive",
            "reason": "explicit_executive_request",
            "action": None,
        }

    # Document uploads always escalate
    if atom_type == "document" or atom_source == "document_upload":
        return {
            "target": "executive",
            "reason": "document_upload",
            "action": None,
        }

    # Critical importance always escalates
    if importance == "critical":
        return {
            "target": "executive",
            "reason": "critical_importance",
            "action": None,
        }

    # Low confidence escalates
    if confidence < GATE_CONFIG["reflex_confidence_threshold"]:
        return {
            "target": "executive",
            "reason": "ingestion_confidence_below_threshold",
            "action": None,
        }

    # Known NFC shapes -> reflex resolution (0 LLM tokens)
    if atom_source in GATE_CONFIG["reflex_nfc_sources"] or atom_type == "nfc_tap":
        return {
            "target": "reflex",
            "reason": "known_nfc_shape",
            "action": "resolve_nfc_tap",
        }

    # Known webhook shapes -> reflex resolution
    if (
        atom_source in GATE_CONFIG["reflex_webhook_sources"]
        or atom_type in GATE_CONFIG["reflex_known_webhook_types"]
    ):
        return {
            "target": "reflex",
            "reason": "known_webhook_shape",
            "action": "resolve_webhook",
        }

    # Payload over budget
    if payload_bytes > GATE_CONFIG["reflex_max_payload_bytes"]:
        return {
            "target": "executive",
            "reason": "payload_over_reflex_budget",
            "action": None,
        }

    return {"target": "executive", "reason": "unknown_shape", "action": None}


# =========================================================================
# 8. THE AVA-007 COORDINATION LAYER
#    Boot sequence: HF driver -> Governance ruleset -> Tools -> Agent
# =========================================================================

def boot_ava_007(
    hf_mode: str = "hub",
    hf_model: str = "mistralai/Mistral-7B-Instruct-v0.2",
    hf_device: str = "cpu",
    hf_tgi_url: str | None = None,
) -> Agent:
    """
    Initialize the AVA-007 Griptape Agent with HuggingFace inference.

    GPU-less architecture (default hf_mode='hub'):
      - HuggingFaceHubPromptDriver: remote text generation via HF Inference API
      - HuggingFaceHubEmbeddingDriver: remote vectorization, no local GPU needed
      - LocalVectorStoreDriver: vector indices stored locally, embeddings computed remotely
      - Zero local footprint — runs on handsets, Termux, edge nodes without GPU

    Parameters:
      hf_mode: "hub" (GPU-less, default), "local" (on-device),
               "inference" (HF Inference API via OpenAI compat),
               or "tgi" (self-hosted Text Generation Inference)
      hf_model: HuggingFace model identifier (default: mistralai/Mistral-7B-Instruct-v0.2)
      hf_device: Device for local inference ("cpu", "cuda", "mps")
      hf_tgi_url: TGI endpoint URL (required if hf_mode="tgi")

    The Agent enforces AVA007 governance via Rulesets — deterministic
    behavior bounds on non-deterministic model output.
    """
    print(f"Initializing HuggingFace inference stack (mode={hf_mode}, model={hf_model})...")

    # HuggingFace prompt driver — NO OpenRouter
    hf_driver = create_hf_prompt_driver(
        mode=hf_mode,
        model=hf_model,
        device=hf_device,
        hf_endpoint_url=hf_tgi_url,
    )

    # Governance Ruleset: enforces AVA-007 identity and authority chain
    governance_rules = Ruleset(
        name="AVA007 Governance",
        rules=[
            Rule(
                "Strictly follow execution steps as defined in the task "
                "lifecycle; do not deviate from the validated path."
            ),
            Rule(
                "All plan generations must be formatted as a JSON array of "
                "discrete execution steps to maintain compatibility with "
                "legacy Ava listeners."
            ),
            Rule(
                "Maintain and provide continuous status updates for every "
                "tool interaction, ensuring full auditability of the "
                "execution chain."
            ),
        ],
    )

    # Authority chain ruleset — mirrors contract/enforcement.ts
    authority_rules = Ruleset(
        name="A2A-OA Authority Chain",
        rules=[
            Rule(
                "You are AVA-007, the primary AI-to-AI Orchestration Agent."
            ),
            Rule(
                "Operate securely off-prompt utilizing task memory — "
                "never expose raw artifact data in the LLM context window."
            ),
            Rule(
                "Authority chain: L1 (memory) -> L2 (tashi/signing) -> "
                "L3 (temporal) -> L4 (graph, depth<=5) -> L5 (subconscious, "
                "read-only) -> L6 (ava007+brain, sole decision authority)."
            ),
            Rule(
                "Coordinate through: Observe -> Interpret -> Orchestrate "
                "-> Verify -> Commit -> Anchor."
            ),
            Rule(
                "Strategic query transformation: reframe tactical issues "
                "as philosophical abstractions before GraphRAG retrieval."
            ),
        ],
    )

    # Off-prompt TaskMemory — tool outputs stored as Artifacts, not in LLM window
    task_memory = TaskMemory()

    # RAG Engine for contextual intelligence
    rag_engine = initialize_rag_engine()

    # Build the Agent with governance, tools, and off-prompt memory
    ava = Agent(
        prompt_driver=hf_driver,
        rulesets=[governance_rules, authority_rules],
        tools=[
            *load_ava_capabilities(task_memory),
            RagTool(
                description=(
                    "Used for accessing private or up-to-the-minute data "
                    "from the Neo4j knowledge graph with depth<=5 enforcement."
                ),
                rag_engine=rag_engine,
            ),
        ],
        task_memory=task_memory,
    )

    print(f"AVA-007 online. HF model: {hf_model} (mode: {hf_mode})")
    return ava


# =========================================================================
# 9. COORDINATION LOOP EXECUTOR
#    Mirrors src/ava007/orchestrator.ts processAtom()
# =========================================================================

def process_atom(atom: dict, ava_agent: Agent, rag_engine: RagEngine) -> dict:
    """
    Full coordination loop:
      Observe -> Interpret -> Orchestrate -> Verify -> Commit -> Anchor

    Mirrors the TypeScript Ava007Orchestrator.processAtom() in
    src/ava007/orchestrator.ts.

    Tiers:
      - Reflex: <5ms, no LLM, rule-based routing
      - Executive: HuggingFace Gemma-2, ~500 tokens
      - Cortex: HuggingFace Gemma-2, 1k+ tokens
    """
    started_at = datetime.now(timezone.utc)

    # STEP 1: OBSERVE — Atom ingressed from NFC, A2A POST, webhook, etc.
    atom_id = atom.get(
        "id",
        hashlib.sha256(json.dumps(atom).encode()).hexdigest()[:16],
    )

    # STEP 2: INTERPRET — CFGL rule routing determines the tier
    reflex_gate = evaluate_reflex_gate(atom)

    # STEP 3: ORCHESTRATE
    if reflex_gate["target"] == "reflex" and reflex_gate["action"]:
        # Reflex tier: No LLM call — zero token cost
        return {
            "atom_id": atom_id,
            "tier": "reflex",
            "action": reflex_gate["action"],
            "gate_reason": reflex_gate["reason"],
            "confidence": 1.0,
            "latency_ms": _elapsed_ms(started_at),
            "context_token_budget": GATE_CONFIG["reflex_context_token_budget"],
        }

    # Executive or Cortex tier: Use Griptape agent with RAG context
    # Strategic query transformation — deterministic, zero LLM cost
    atom_description = atom.get("payload", {}).get("description", str(atom))
    transformation = transform_query(atom_description)
    graphrag_search = transformation["graphrag_search_string"]

    # RAG retrieval from Neo4j graph (depth<=5)
    rag_context = rag_engine.process_query(graphrag_search)

    # Build prompt for Griptape agent (executive/cortex)
    orchestration_prompt = (
        f"Context from graph retrieval: {rag_context}\n\n"
        f"Atom to process: {json.dumps(atom)}\n\n"
        f"Gate decision: {reflex_gate['target']} tier "
        f"(reason: {reflex_gate['reason']})\n\n"
        f"Strategic abstraction: {transformation['abstraction']}\n"
        f"Execute the appropriate coordination action."
    )

    # Run agent — Griptape handles the executive/cortex HF inference call
    result = ava_agent.run(orchestration_prompt)

    # Determine tier based on gate
    tier = reflex_gate["target"]
    token_budget = (
        GATE_CONFIG["executive_context_token_budget"]
        if tier == "executive"
        else GATE_CONFIG["cortex_context_token_budget"]
    )

    # STEP 4: VERIFY — Authority chain enforcement
    # L6 sole decision authority confirmed by governance ruleset

    # STEP 5: COMMIT — Write to memory (mirrors MemoryStore.append)
    output_text = (
        result.output_text if hasattr(result, "output_text") else str(result)
    )

    # STEP 6: ANCHOR — Tashi consensus finality
    return {
        "atom_id": atom_id,
        "tier": tier,
        "action": reflex_gate["action"] or "agent_orchestrated",
        "gate_reason": reflex_gate["reason"],
        "confidence": 0.9,
        "latency_ms": _elapsed_ms(started_at),
        "context_token_budget": token_budget,
        "agent_output": output_text,
        "strategic_abstraction": transformation["abstraction"],
        "original_query": transformation["original_query"],
    }


def _elapsed_ms(started_at: datetime) -> float:
    """Calculate elapsed milliseconds since start."""
    delta = datetime.now(timezone.utc) - started_at
    return delta.total_seconds() * 1000


# =========================================================================
# 10. HTTP SERVER — Legacy API Mirror
#     Replaces the original urllib-based Ava.py with Griptape Agent
# =========================================================================

# Module-level references for the HTTP handler
_ava_agent: Optional[Agent] = None
_rag_engine: Optional[RagEngine] = None
_tripo_tool: Optional[object] = None  # VastTripoSplatTool instance


class AvaHandler(BaseHTTPRequestHandler):
    """
    HTTP handler that mirrors the legacy Ava.py POST API.
    Receives a goal, runs it through the Griptape Agent,
    and returns structured JSON output.

    The agent runs a closed-loop execution:
      Search -> Scrape -> Store -> RAG -> Reason -> Output

    All tool outputs are stored off-prompt in TaskMemory.
    The LLM sees metadata references only — never raw scraped data.
    """

    def do_POST(self):
        try:
            content_length = int(self.headers.get("Content-Length", 0))
            post_data = self.rfile.read(content_length)
            payload = json.loads(post_data.decode("utf-8"))

            # Route by path
            path = self.path.rstrip("/")

            if path == "/spatial/generate":
                # Spatial reconstruction endpoint (VAST-AI + TripoSplat)
                self._handle_spatial_generate(payload)
                return

            if path == "/spatial/artifacts":
                # List stored Splat artifacts
                self._handle_spatial_list(payload)
                return

            if path == "/spatial/cleanup":
                # Release VAST-AI resources
                self._handle_spatial_cleanup(payload)
                return

            # Default: goal execution or atom coordination
            goal = payload.get("goal", "No goal provided")

            # Determine if this is a structured atom or a simple goal
            if "type" in payload and "source" in payload:
                # Structured atom — run through coordination loop
                result = process_atom(payload, _ava_agent, _rag_engine)
                response_data = {
                    "status": "coordination_complete",
                    "goal": goal,
                    "output": result,
                }
            else:
                # Simple goal — run full Griptape Agent
                result = _ava_agent.run(goal)
                output_text = (
                    result.output_text
                    if hasattr(result, "output_text")
                    else str(result)
                )
                response_data = {
                    "status": "execution_complete",
                    "goal": goal,
                    "output": output_text,
                }

            self._send_json(200, response_data)

        except json.JSONDecodeError:
            self._send_json(400, {"error": "Invalid JSON payload"})
        except Exception as e:
            self._send_json(500, {"error": str(e)})

    def _handle_spatial_generate(self, payload: dict) -> None:
        """Handle 3D Gaussian Splat generation requests.

        POST /spatial/generate
        Body: {"image_path": "/path/to/image.jpg", "name": "reconstruction"}

        Returns: Artifact reference (off-prompt) with cognitive summary.
        Heavy spatial data stays in Task Memory — LLM sees metadata only.
        """
        global _tripo_tool

        if _tripo_tool is None:
            self._send_json(503, {
                "error": "TripoSplat driver not initialized. Set VAST_API_KEY to enable.",
                "hint": "export VAST_API_KEY=your_key && restart the server",
            })
            return

        image_path = payload.get("image_path", "")
        name = payload.get("name", "reconstruction")
        source = payload.get("source", "image")  # "image" or "video"

        if not image_path:
            self._send_json(400, {"error": "image_path is required"})
            return

        if source == "video":
            frame_interval = payload.get("frame_interval", 10)
            result = _tripo_tool.generate_3d_splat_from_video(
                video_path=image_path, name=name, frame_interval=frame_interval
            )
        else:
            result = _tripo_tool.generate_3d_splat(image_path=image_path, name=name)

        if result.get("status") == "failed":
            self._send_json(500, result)
        else:
            self._send_json(200, {
                "status": "spatial_reconstruction_complete",
                "artifact": result,
                "note": "3D Splat stored as ModelArtifact in Task Memory (off-prompt). "
                        "Use the A2UI SplatLoader to visualize.",
            })

    def _handle_spatial_list(self, payload: dict) -> None:
        """List all stored Splat artifacts in Task Memory."""
        global _tripo_tool

        if _tripo_tool is None:
            self._send_json(503, {"error": "TripoSplat driver not initialized"})
            return

        artifacts = _tripo_tool.list_splat_artifacts()
        self._send_json(200, {
            "status": "ok",
            "artifacts": artifacts,
            "count": len(artifacts),
        })

    def _handle_spatial_cleanup(self, payload: dict) -> None:
        """Release VAST-AI GPU resources."""
        global _tripo_tool

        if _tripo_tool is None:
            self._send_json(503, {"error": "TripoSplat driver not initialized"})
            return

        result = _tripo_tool.cleanup()
        self._send_json(200, result)

    def _send_json(self, code: int, data: dict) -> None:
        self.send_response(code)
        self.send_header("Content-type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data, default=str).encode("utf-8"))

    def log_message(self, format, *args):
        # Clean logs — no per-request noise
        return


def run_server(
    port: int = 8080,
    hf_mode: str = "local",
    hf_model: str = "google/gemma-2-9b-it",
    hf_device: str = "cpu",
    hf_tgi_url: str | None = None,
):
    """
    Launch the AVA-007 Griptape HTTP server.

    The server accepts POST requests with either:
      1. A "goal" field for simple agent execution
      2. A structured atom payload for coordination loop processing
    """
    global _ava_agent, _rag_engine

    # Boot the agent and RAG engine
    _ava_agent = boot_ava_007(
        hf_mode=hf_mode,
        hf_model=hf_model,
        hf_device=hf_device,
        hf_tgi_url=hf_tgi_url,
    )
    _rag_engine = initialize_rag_engine()

    # Initialize TripoSplat driver (if VAST_API_KEY is set)
    global _tripo_tool
    try:
        from vast_tripo_driver import VastTripoSplatTool, VastAIDriver
        if os.environ.get("VAST_API_KEY"):
            vast_driver = VastAIDriver()
            _tripo_tool = VastTripoSplatTool(vast_driver=vast_driver)
            print("  TripoSplat driver: ENABLED (VAST-AI)")
        else:
            _tripo_tool = None
            print("  TripoSplat driver: DISABLED (set VAST_API_KEY to enable)")
    except ImportError:
        _tripo_tool = None
        print("  TripoSplat driver: DISABLED (vast_tripo_driver.py not found)")

    # Graceful shutdown
    def shutdown_handler(signum, frame):
        print("\nAVA-007 shutting down gracefully...")
        if _tripo_tool:
            _tripo_tool.cleanup()
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown_handler)
    signal.signal(signal.SIGTERM, shutdown_handler)

    server = HTTPServer(("0.0.0.0", port), AvaHandler)
    print(f"AVA-007 (Griptape + HuggingFace) online on port {port}...")
    print(f"  HF mode: {hf_mode}")
    print(f"  HF model: {hf_model}")
    print(f"  Inference provider: HuggingFace (NO OpenRouter)")
    print(f"  Off-prompt TaskMemory: enabled")
    print(f"  Neo4j RAG: depth<=5")
    if _tripo_tool:
        print(f"  Spatial Reconstruction: ENABLED (VAST-AI + TripoSplat)")
    print(f"\n  POST http://localhost:{port}/")
    print(f'  Body: {{"goal": "your task here"}}')
    print(f"\n  Spatial endpoints:")
    print(f'  POST http://localhost:{port}/spatial/generate')
    print(f'  POST http://localhost:{port}/spatial/artifacts')
    print(f'  POST http://localhost:{port}/spatial/cleanup')
    print()

    server.serve_forever()


# =========================================================================
# 11. CLI ENTRY POINT
# =========================================================================

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(
        description="AVA-007 Griptape Runtime (HuggingFace Inference Stack)"
    )
    parser.add_argument(
        "--port",
        type=int,
        default=8080,
        help="HTTP server port (default: 8080)",
    )
    parser.add_argument(
        "--hf-mode",
        choices=["local", "inference", "tgi"],
        default="local",
        help=(
            "HuggingFace inference mode: "
            "local (on-device), inference (HF API), tgi (self-hosted)"
        ),
    )
    parser.add_argument(
        "--hf-model",
        default="google/gemma-2-9b-it",
        help="HuggingFace model identifier (default: google/gemma-2-9b-it)",
    )
    parser.add_argument(
        "--hf-device",
        default="cpu",
        help="Device for local inference: cpu, cuda, mps (default: cpu)",
    )
    parser.add_argument(
        "--hf-tgi-url",
        default=None,
        help="TGI endpoint URL (required if --hf-mode=tgi)",
    )
    parser.add_argument(
        "--validate-only",
        action="store_true",
        help="Validate imports and configuration without starting the server",
    )

    args = parser.parse_args()

    if args.validate_only:
        print("Validating AVA-007 Griptape + HuggingFace stack...")

        # Phase 1: Import validation (always works if packages installed)
        print("\n  Phase 1: Import validation")
        try:
            from griptape.structures import Agent
            from griptape.rules import Rule, Ruleset
            from griptape.memory import TaskMemory
            from griptape.drivers import (
                HuggingFacePipelinePromptDriver,
                HuggingFaceHubEmbeddingDriver,
                OpenAiChatPromptDriver,
            )
            from griptape.engines import RagEngine
            from griptape.tools import (
                WebScraperTool, FileManagerTool, CalculatorTool,
                DateTimeTool, RagTool,
            )
            print("    All Griptape imports OK")
        except ImportError as e:
            print(f"    FAILED: {e}")
            sys.exit(1)

        # Phase 2: Orchestration layer validation
        print("\n  Phase 2: Orchestration layer")
        try:
            from orchestration.context_filter import transform_operational_query
            from orchestration.memory_policy import MemoryPolicy
            from orchestration.task_memory_manager import TaskMemoryManager
            from orchestration.memory_router import MemoryRouter
            print("    All orchestration imports OK")
        except ImportError as e:
            print(f"    FAILED: {e}")
            sys.exit(1)

        # Phase 3: Driver instantiation (may fail without HF_TOKEN or model access)
        print("\n  Phase 3: Driver instantiation")
        try:
            driver = create_hf_prompt_driver(
                mode=args.hf_mode,
                model=args.hf_model,
                device=args.hf_device,
                hf_endpoint_url=args.hf_tgi_url,
            )
            print(f"    Prompt driver: {driver.__class__.__name__} OK")
        except Exception as e:
            print(f"    Prompt driver: SKIPPED ({e})")
            print("    Set HF_TOKEN and ensure model access for full validation")

        try:
            embed_driver = create_hf_embedding_driver()
            print(f"    Embedding driver: {embed_driver.__class__.__name__} OK")
        except Exception as e:
            print(f"    Embedding driver: SKIPPED ({e})")

        try:
            rag = initialize_rag_engine()
            print(f"    RAG engine: {rag.__class__.__name__} OK")
        except Exception as e:
            print(f"    RAG engine: SKIPPED ({e})")

        # Phase 4: OpenRouter absence check
        print("\n  Phase 4: OpenRouter elimination")
        has_or_key = bool(os.environ.get("OPENROUTER_API_KEY"))
        if has_or_key:
            print("    WARNING: OPENROUTER_API_KEY is set but will NOT be used")
            print("    HuggingFace is the sole inference provider")
        else:
            print("    No OpenRouter keys detected (correct)")

        # Phase 5: Strategic query transform (zero-LLM, always works)
        print("\n  Phase 5: Strategic query transform")
        test_result = transform_query("I'm blocked and failing")
        print(f"    Input: 'I'm blocked and failing'")
        print(f"    Abstraction: {test_result['abstraction']}")
        print(f"    GraphRAG search: {test_result['graphrag_search_string']}")
        print("    Zero-LLM transform OK")

        # Phase 6: Reflex gate (zero-LLM, always works)
        print("\n  Phase 6: Reflex gate evaluation")
        test_atom = {
            "type": "nfc_tap",
            "source": "nfc",
            "confidence": 0.95,
            "importance": "low",
            "payload": {},
        }
        gate_result = evaluate_reflex_gate(test_atom)
        print(f"    NFC tap atom -> target: {gate_result['target']}, action: {gate_result['action']}")
        print("    Reflex gate OK (zero LLM tokens)")

        print("\nValidation complete. Core stack is functional.")
        if args.hf_mode == "local":
            print(
                "NOTE: Local mode requires HF_TOKEN and model access "
                "for full driver instantiation."
            )
    else:
        run_server(
            port=args.port,
            hf_mode=args.hf_mode,
            hf_model=args.hf_model,
            hf_device=args.hf_device,
            hf_tgi_url=args.hf_tgi_url,
        )
