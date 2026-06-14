"""
QAG-MemBrain DualBrain Layer (LAYER 6: DUALBRAIN INFERENCE ROUTER).

Routes queries between Graph-based retrieval (deterministic, no LLM) and
Prompt-based generation (LLM-powered), with a Hybrid mode that combines
both.  Integrates with the Ava007Orchestrator's three-tier system
(Reflex → Executive → Cortex).

Three routing modes:
    GRAPH   — Deterministic graph traversal (fast, no LLM, high precision)
    PROMPT  — LLM-based generation (creative, flexible, higher latency)
    HYBRID  — Graph first, prompt augmentation (best of both worlds)

Three routing strategies:
    CONSERVATIVE — Prefer GRAPH; high threshold (0.7) for PROMPT
    BALANCED     — Default strategy; threshold 0.5
    AGGRESSIVE   — Prefer PROMPT; low threshold (0.3)

Quick start::

    from ava007.membrain.dualbrain import DualBrainRouter, RoutingStrategy

    router = DualBrainRouter(strategy=RoutingStrategy.BALANCED)

    # Route a query
    decision = router.route("What is the status of deployment?")
    print(decision.mode)        # "GRAPH"
    print(decision.confidence)  # 0.72

    # Execute in GRAPH mode
    graph_result = router.execute_graph("What is the status?", graph_data)

    # Execute in HYBRID mode (graph + prompt)
    hybrid_result = router.execute_hybrid("Compare deployment strategies", ...)
    print(hybrid_result.final_answer)
"""

from .dualbrain_router import (
    DualBrainRouter,
    GraphResult,
    HybridResult,
    PromptResult,
    RoutingDecision,
)
from .routing import (
    QueryClassification,
    RoutingContext,
    RoutingEngine,
    RoutingMode,
    RoutingStrategy,
)
from .augmentation import (
    AugmentedQuery,
    Contradiction,
    QueryAugmenter,
)

__all__ = [
    # Core router
    "DualBrainRouter",
    "RoutingDecision",
    # Result types
    "GraphResult",
    "PromptResult",
    "HybridResult",
    # Routing engine
    "RoutingEngine",
    "RoutingStrategy",
    "RoutingMode",
    "QueryClassification",
    "RoutingContext",
    # Augmentation
    "QueryAugmenter",
    "AugmentedQuery",
    "Contradiction",
]
