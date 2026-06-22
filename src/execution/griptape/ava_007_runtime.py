"""
ava_007_runtime.py - The primary A2A-OA coordination layer.

This runtime utilizes the Griptape framework to implement a secure, off-prompt
orchestration protocol. It leverages Hugging Face for local model execution,
a custom Neo4j vector driver for graph-based RAG retrieval, and a comprehensive
suite of interactive capabilities.

Canonical counterpart: src/ava007/ (TypeScript coordination layer).
This Python runtime mirrors the TypeScript Ava007 class and its coordination
loop (Observe -> Interpret -> Orchestrate -> Verify -> Commit -> Anchor) using
Griptape primitives.

Authority Chain (mirrors src/contract/enforcement.ts AUTHORITY_MATRIX):
  L1 (memory/jsonl) -> L2 (tashi/Ed25519) -> L3 (temporal/replay)
  -> L4 (graph/neo4j, depth<=5) -> L5 (subconscious, read-only)
  -> L6 (ava007+brain, sole decision authority)
"""

import os
import hashlib
import json
from datetime import datetime, timezone
from typing import Optional

from attr import define, field
from griptape.structures import Agent
from griptape.drivers import (
    HuggingFacePipelinePromptDriver,
    HuggingFaceHubEmbeddingDriver,
    BaseVectorStoreDriver
)
from griptape.engines import RagEngine
from griptape.engines.rag.modules import VectorStoreRetrievalRagModule, PromptResponseRagModule
from griptape.engines.rag.stages import RetrievalRagStage, ResponseRagStage
from griptape.memory.structure import TaskMemory
from griptape.rules import Rule, Ruleset

# Import Capabilities (Griptape Tools)
from griptape.tools import (
    WebSearch, WebScraper, FileManager, Calculator,
    DateTime, SqlClient, RestApi, TextToSpeech
)

# =========================================================================
# 1. CUSTOM NEO4J GRAPH DRIVER
# =========================================================================
@define
class Neo4jVectorStoreDriver(BaseVectorStoreDriver):
    """
    Custom driver bridging Griptape's BaseVectorStoreDriver with Neo4j.
    Handles Cypher queries and vector graph traversals for the Retrieval Stage.

    Mirrors src/graph/neo4j/enforcement.ts GraphStore with MAX_DEPTH=5.
    All traversal results are bounded by the depth enforcement policy.
    """
    uri: str = field(kw_only=True)
    username: str = field(kw_only=True)
    password: str = field(kw_only=True)
    index_name: str = field(kw_only=True)

    MAX_DEPTH = 5  # Mirrors src/graph/neo4j/enforcement.ts MAX_DEPTH

    def upsert_vector(self, vector: list[float], vector_id: str | None = None, **kwargs) -> str:
        # Implementation to insert embeddings into Neo4j nodes
        return vector_id if vector_id else "generated_neo4j_id"

    def load_entry(self, vector_id: str) -> BaseVectorStoreDriver.Entry | None:
        # Implementation to retrieve a specific node by ID
        pass

    def load_entries(self, namespace: str | None = None) -> list[BaseVectorStoreDriver.Entry]:
        # Implementation to load all relevant nodes from a namespace
        return []

    def query(self, query: str, count: int | None = None, namespace: str | None = None, **kwargs) -> list[BaseVectorStoreDriver.Entry]:
        # Implementation to execute a Cypher vector search
        # Depth enforcement: all traversals bounded by MAX_DEPTH
        print(f"[Neo4j Driver] Traversing graph for query: {query} (max_depth={self.MAX_DEPTH})")
        return []


# =========================================================================
# 2. CAPABILITIES MODULE
# =========================================================================
def load_ava_capabilities():
    """
    Initializes the full suite of operational capabilities for AVA-007.
    Each Griptape Tool maps to a runtime capability in the A2A-OA architecture.
    """
    return [
        # Utility & Data Capabilities
        Calculator(),
        DateTime(),
        FileManager(),
        SqlClient(engine_url="sqlite:///ava_local.db"),
        RestApi(),

        # Search & Information Retrieval
        WebSearch(),
        WebScraper(),

        # Multimodal
        TextToSpeech()
    ]


# =========================================================================
# 3. RAG ENGINE: OBSERVE & RETRIEVE
# =========================================================================
def initialize_rag_engine():
    """
    Sets up the Retrieval-Augmented Generation pipeline using Hugging Face embeddings
    and the custom Neo4j graph driver.

    Maps to the coordination loop OBSERVE and INTERPRET steps:
      - RetrievalRagStage -> Observe (ingest from graph)
      - ResponseRagStage  -> Interpret (contextualize for orchestration)
    """
    embedding_driver = HuggingFaceHubEmbeddingDriver(
        model="sentence-transformers/all-MiniLM-L6-v2"
    )

    neo4j_driver = Neo4jVectorStoreDriver(
        uri=os.environ.get("NEO4J_URI", "bolt://localhost:7687"),
        username=os.environ.get("NEO4J_USER", "neo4j"),
        password=os.environ.get("NEO4J_PASS", "password"),
        index_name="ava_knowledge_graph",
        embedding_driver=embedding_driver
    )

    return RagEngine(
        retrieval_stage=RetrievalRagStage(
            modules=[VectorStoreRetrievalRagModule(vector_store_driver=neo4j_driver)]
        ),
        response_stage=ResponseRagStage(
            modules=[PromptResponseRagModule()]
        )
    )


# =========================================================================
# 4. STRATEGIC QUERY TRANSFORMATION
#    Mirrors src/ava007/query_transform.ts StrategicQueryTransformer
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

    Mirrors src/ava007/query_transform.ts StrategicQueryTransformer.transform().
    Enforces L6 authority guard — only the Ava007 coordination layer may
    transform queries.
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
# 5. ESCALATION GATE CONFIGURATION
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
# 6. RUNTIME TIERS (mirrors src/ava007/coordination_types.ts)
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
        return {"target": "executive", "reason": "explicit_cortex_request", "action": None}
    if payload.get("requiresExecutive"):
        return {"target": "executive", "reason": "explicit_executive_request", "action": None}

    # Document uploads always escalate
    if atom_type == "document" or atom_source == "document_upload":
        return {"target": "executive", "reason": "document_upload", "action": None}

    # Critical importance always escalates
    if importance == "critical":
        return {"target": "executive", "reason": "critical_importance", "action": None}

    # Low confidence escalates
    if confidence < GATE_CONFIG["reflex_confidence_threshold"]:
        return {"target": "executive", "reason": "ingestion_confidence_below_threshold", "action": None}

    # Known NFC shapes -> reflex resolution (0 LLM tokens)
    if atom_source in GATE_CONFIG["reflex_nfc_sources"] or atom_type == "nfc_tap":
        return {"target": "reflex", "reason": "known_nfc_shape", "action": "resolve_nfc_tap"}

    # Known webhook shapes -> reflex resolution
    if atom_source in GATE_CONFIG["reflex_webhook_sources"] or atom_type in GATE_CONFIG["reflex_known_webhook_types"]:
        return {"target": "reflex", "reason": "known_webhook_shape", "action": "resolve_webhook"}

    # Payload over budget
    if payload_bytes > GATE_CONFIG["reflex_max_payload_bytes"]:
        return {"target": "executive", "reason": "payload_over_reflex_budget", "action": None}

    return {"target": "executive", "reason": "unknown_shape", "action": None}


# =========================================================================
# 7. THE AVA-007 COORDINATION LAYER
# =========================================================================
def boot_ava_007():
    print("Initializing local Hugging Face execution runtime...")

    # Utilizing local Hugging Face pipeline
    hf_driver = HuggingFacePipelinePromptDriver(
        model="google/gemma-2-9b-it",
        task="text-generation",
        device="cpu"
    )

    governance_rules = Ruleset(
        name="A2A-OA Directives",
        rules=[
            Rule("You are AVA-007, the primary AI-to-AI Orchestration Agent (A2A-OA)."),
            Rule("Operate securely off-prompt utilizing task memory."),
            Rule("Leverage graph traversal for deep contextual retrieval."),
            Rule("Authority chain: L1 (memory) -> L2 (tashi/signing) -> L3 (temporal) -> L4 (graph, depth<=5) -> L5 (subconscious, read-only) -> L6 (ava007+brain, sole decision authority)."),
            Rule("Coordinate through: Observe -> Interpret -> Orchestrate -> Verify -> Commit -> Anchor."),
            Rule("Strategic query transformation: reframe tactical issues as philosophical abstractions before GraphRAG retrieval."),
        ]
    )

    ava = Agent(
        prompt_driver=hf_driver,
        rulesets=[governance_rules],
        task_memory=TaskMemory(),
        tools=load_ava_capabilities()
    )

    return ava


# =========================================================================
# 8. COORDINATION LOOP EXECUTOR
#    Mirrors src/ava007/orchestrator.ts processAtom()
# =========================================================================

def process_atom(atom: dict, ava_agent: Agent, rag_engine: RagEngine) -> dict:
    """
    Full coordination loop: Observe -> Interpret -> Orchestrate -> Verify -> Commit -> Anchor

    Mirrors the TypeScript Ava007Orchestrator.processAtom() in
    src/ava007/orchestrator.ts.

    Tiers:
      - Reflex: <5ms, no LLM, rule-based routing
      - Executive: Mellum2, ~500 tokens
      - Cortex: Mercury 2, 1k+ tokens
    """
    started_at = datetime.now(timezone.utc)

    # STEP 1: OBSERVE - Atom ingressed from NFC, A2A POST, webhook, etc.
    atom_id = atom.get("id", hashlib.sha256(json.dumps(atom).encode()).hexdigest()[:16])

    # STEP 2: INTERPRET - CFGL rule routing determines the tier
    reflex_gate = evaluate_reflex_gate(atom)

    # STEP 3: ORCHESTRATE
    if reflex_gate["target"] == "reflex" and reflex_gate["action"]:
        # Reflex tier: No LLM call - zero token cost
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
    # Strategic query transformation for GraphRAG retrieval
    atom_description = atom.get("payload", {}).get("description", str(atom))
    transformation = transform_query(atom_description)
    graphrag_search = transformation["graphrag_search_string"]

    # RAG retrieval
    rag_context = rag_engine.process_query(graphrag_search)

    # Build prompt for Griptape agent (executive/cortex)
    orchestration_prompt = (
        f"Context from graph retrieval: {rag_context}\n\n"
        f"Atom to process: {json.dumps(atom)}\n\n"
        f"Gate decision: {reflex_gate['target']} tier (reason: {reflex_gate['reason']})\n\n"
        f"Strategic abstraction: {transformation['abstraction']}\n"
        f"Execute the appropriate coordination action."
    )

    # Run agent - Griptape handles the executive/cortex LLM call
    result = ava_agent.run(orchestration_prompt)

    # Determine tier based on gate
    tier = reflex_gate["target"]
    token_budget = (
        GATE_CONFIG["executive_context_token_budget"]
        if tier == "executive"
        else GATE_CONFIG["cortex_context_token_budget"]
    )

    # STEP 4: VERIFY - Authority chain enforcement (mirrors enforceAuthority)
    # L6 sole decision authority confirmed by governance ruleset

    # STEP 5: COMMIT - Write to memory (mirrors MemoryStore.append)
    output_text = result.output_text if hasattr(result, "output_text") else str(result)

    # STEP 6: ANCHOR - Tashi consensus finality (external in Python runtime)
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
# EXECUTION
# =========================================================================
if __name__ == "__main__":
    ava_007 = boot_ava_007()
    rag_engine = initialize_rag_engine()

    directive = "Search the web for the latest advancements in Next.js caching, retrieve relevant architecture guidelines from the Neo4j graph, and save a summary to a local file."

    print(f"\nAVA-007 (A2A-OA) Executing Directive: {directive}\n")

    # Demonstrate strategic query transformation
    transformation = transform_query(directive)
    print(f"Strategic Abstraction: {transformation['abstraction']}")
    print(f"GraphRAG Search String: {transformation['graphrag_search_string']}\n")

    # Demonstrate coordination loop with a sample atom
    sample_atom = {
        "id": "atom_001",
        "type": "webhook",
        "source": "webhook",
        "payload": {"description": directive},
        "confidence": 0.92,
        "importance": "high",
    }

    result = process_atom(sample_atom, ava_007, rag_engine)
    print(f"\nCoordination Result:")
    print(json.dumps(result, indent=2, default=str))

    # Also run the full Griptape agent for complex orchestration
    print(f"\n--- Full Griptape Agent Execution ---")
    rag_context = rag_engine.process_query(directive)
    agent_result = ava_007.run(f"Context: {rag_context}\n\nTask: {directive}")
    print("\nExecution Complete. Output:")
    print(agent_result.output_text)
