"""
dualbrain_router.py — Core DualBrain Router for QAG-MemBrain (L6).

Central routing coordinator that decides how to process each query through
the three DualBrain modes: GRAPH, PROMPT, and HYBRID.

The DualBrainRouter integrates with the Ava007Orchestrator's three-tier
system:

  - **Reflex** tier: fast classification and routing (this router)
  - **Executive** tier: planning and orchestration (prompt configuration)
  - **Cortex** tier: deep synthesis and learning (hybrid augmentation)

Routing flow:
  1. ``route()``        — classify + decide mode → RoutingDecision
  2. ``execute_*()``    — execute the chosen mode
  3. Results flow back  — for HYBRID, contradictions are checked

Core classes:
    DualBrainRouter  — Central routing coordinator
    RoutingDecision  — Routing decision output
    GraphResult      — GRAPH mode result
    PromptResult     — PROMPT mode result
    HybridResult     — HYBRID mode result
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Set

from .augmentation import AugmentedQuery, Contradiction, QueryAugmenter
from .routing import (
    QueryClassification,
    RoutingContext,
    RoutingEngine,
    RoutingMode,
    RoutingStrategy,
)


# ---------------------------------------------------------------------------
# Result data structures
# ---------------------------------------------------------------------------

@dataclass
class RoutingDecision:
    """Output of the routing decision process.

    Attributes:
        mode:               The chosen routing mode (GRAPH/PROMPT/HYBRID).
        confidence:         Confidence score for this routing decision.
        reason:             Human-readable explanation of the decision.
        estimated_latency_ms: Estimated wall-clock latency in ms.
        token_budget:       Maximum tokens to use for LLM calls.
    """
    mode: str  # "GRAPH" | "PROMPT" | "HYBRID"
    confidence: float
    reason: str
    estimated_latency_ms: float
    token_budget: int


@dataclass
class GraphResult:
    """Result of GRAPH mode execution (deterministic graph traversal).

    Attributes:
        answer:       The answer derived from graph traversal.
        paths:        Graph paths traversed to produce the answer.
        confidence:   Confidence in the graph-derived answer.
        source_nodes: IDs of nodes that contributed to the answer.
    """
    answer: str
    paths: List[dict] = field(default_factory=list)
    confidence: float = 0.0
    source_nodes: List[str] = field(default_factory=list)


@dataclass
class PromptResult:
    """Result of PROMPT mode execution (LLM generation).

    Attributes:
        answer:      The LLM-generated answer.
        tokens_used: Number of tokens consumed.
        confidence:  Confidence in the generated answer.
        model:       Identifier of the LLM model used.
    """
    answer: str
    tokens_used: int = 0
    confidence: float = 0.0
    model: str = ""


@dataclass
class HybridResult:
    """Result of HYBRID mode execution (graph + prompt).

    Attributes:
        graph_result:   Result from the GRAPH phase.
        prompt_result:  Result from the PROMPT phase (None if skipped).
        final_answer:   The merged / final answer.
        confidence:     Overall confidence in the final answer.
        mode:           Always ``"HYBRID"``.
    """
    graph_result: GraphResult
    prompt_result: Optional[PromptResult]
    final_answer: str
    confidence: float
    mode: str = "HYBRID"


# ---------------------------------------------------------------------------
# Graph traversal helpers (standalone, no external deps)
# ---------------------------------------------------------------------------

def _traverse_graph(query: str, graph_data: Optional[dict] = None) -> GraphResult:
    """Perform a deterministic graph traversal to answer *query*.

    This is the built-in graph execution engine.  It searches the provided
    *graph_data* for nodes whose properties or labels match query keywords,
    then traces paths through connected nodes to construct an answer.

    The *graph_data* dict should contain:
      - ``"nodes"``: list of dicts with ``"id"``, ``"labels"``,
        ``"properties"`` keys.
      - ``"edges"``: list of dicts with ``"source"``, ``"target"``,
        ``"type"``, ``"properties"`` keys.

    If *graph_data* is None or empty, returns an empty GraphResult.

    Args:
            query:      The user query.
            graph_data: Graph data dictionary.

    Returns:
            A ``GraphResult`` with the graph-derived answer.
    """
    if not graph_data:
        return GraphResult(
            answer="",
            paths=[],
            confidence=0.0,
            source_nodes=[],
        )

    nodes = graph_data.get("nodes", [])
    edges = graph_data.get("edges", [])

    if not nodes:
        return GraphResult(
            answer="",
            paths=[],
            confidence=0.0,
            source_nodes=[],
        )

    # Tokenise the query for matching
    query_tokens = set(re.findall(r"\b\w{3,}\b", query.lower()))
    _STOP = {"the", "and", "for", "are", "but", "not", "you", "all", "can", "had",
             "her", "was", "one", "our", "out", "has", "have", "from", "been",
             "some", "them", "than", "its", "over", "such", "that", "this",
             "with", "will", "each", "make", "like", "into", "many", "then",
             "what", "about", "which", "when", "where", "who", "how", "why"}
    query_tokens -= _STOP

    # Score each node by keyword overlap
    scored_nodes: List[tuple] = []  # (score, node_dict)
    for node in nodes:
        nid = node.get("id", "")
        labels = node.get("labels", [])
        props = node.get("properties", {})

        node_text = f"{' '.join(labels)} {' '.join(str(v) for v in props.values())}"
        node_tokens = set(re.findall(r"\b\w{3,}\b", node_text.lower()))

        overlap = len(query_tokens & node_tokens)
        if overlap > 0:
            scored_nodes.append((overlap, node))

    if not scored_nodes:
        return GraphResult(
            answer="No matching nodes found in graph.",
            paths=[],
            confidence=0.1,
            source_nodes=[],
        )

    # Sort by score descending
    scored_nodes.sort(key=lambda x: x[0], reverse=True)

    # Build adjacency map for path tracing
    adj: Dict[str, List[tuple]] = {}  # node_id -> [(edge, target_id)]
    for edge in edges:
        src = edge.get("source", "")
        tgt = edge.get("target", "")
        etype = edge.get("type", "")
        if src and tgt:
            adj.setdefault(src, []).append((edge, tgt))

    # Trace paths from top-scored nodes (BFS, max depth 3)
    max_depth = 3
    discovered_paths: List[dict] = []
    visited_path_nodes: Set[str] = set()

    for score, node in scored_nodes[:5]:  # top 5 seed nodes
        nid = node.get("id", "")
        if not nid:
            continue

        # BFS from this node
        queue: List[tuple] = [(nid, [nid], [], 0)]  # (current, path_nodes, path_edges, depth)
        while queue:
            current, path_n, path_e, depth = queue.pop(0)
            if depth >= max_depth:
                continue

            path_key = "->".join(path_n)
            if path_key in visited_path_nodes and depth > 0:
                continue
            visited_path_nodes.add(path_key)

            for edge, target in adj.get(current, []):
                new_path_n = path_n + [target]
                new_path_e = path_e + [edge.get("type", "RELATED_TO")]
                discovered_paths.append({
                    "nodes": list(new_path_n),
                    "edges": list(new_path_e),
                    "cost": depth + 1,
                })
                queue.append((target, new_path_n, new_path_e, depth + 1))

    # Build answer from top-matched node properties
    top_node = scored_nodes[0][1]
    top_nid = top_node.get("id", "unknown")
    top_labels = top_node.get("labels", [])
    top_props = top_node.get("properties", {})

    # Format answer
    answer_parts: List[str] = []
    for label in top_labels:
        answer_parts.append(f"[{label}]")
    for key, val in top_props.items():
        answer_parts.append(f"{key}: {val}")

    # Add related node info from discovered paths
    related_info: List[str] = []
    for path_dict in discovered_paths[:3]:
        path_nodes = path_dict.get("nodes", [])
        if len(path_nodes) > 1:
            for pn in path_nodes[1:]:
                for n in nodes:
                    if n.get("id") == pn:
                        p = n.get("properties", {})
                        for k, v in p.items():
                            related_info.append(f"  {pn}.{k}: {v}")
                        break

    answer = " ".join(answer_parts)
    if related_info:
        answer += "\nRelated:\n" + "\n".join(set(related_info[:5]))

    # Confidence based on score ratio
    max_possible = len(query_tokens) if query_tokens else 1
    confidence = min(1.0, scored_nodes[0][0] / max(max_possible, 1))

    # Collect source nodes from top results
    source_nodes = [n.get("id", "") for _, n in scored_nodes[:5]
                    if n.get("id")]

    return GraphResult(
        answer=answer,
        paths=discovered_paths[:10],
        confidence=confidence,
        source_nodes=source_nodes,
    )


def _generate_prompt(query: str, prompt_config: Optional[dict] = None) -> PromptResult:
    """Simulate an LLM prompt execution (without external LLM dependency).

    In production, this would call mellum2 (executive) or mercury2 (cortex)
    via the Ava007Orchestrator.  Here we provide a deterministic simulation
    that:

    1. Applies the prompt prefix from *prompt_config*
    2. Estimates token usage based on query + config
    3. Returns a structured PromptResult

    The *prompt_config* dict may contain:
      - ``"model"``: model identifier (default ``"mellum2"``)
      - ``"max_tokens"``: maximum tokens for generation
      - ``"temperature"``: sampling temperature
      - ``"system_prefix"``: system prompt prefix
      - ``"context"``: dict of context for augmentation

    Args:
            query:         The user query.
            prompt_config: Configuration for the LLM call.

    Returns:
            A ``PromptResult`` with the simulated answer.
    """
    config = prompt_config or {}
    model = config.get("model", "mellum2")
    max_tokens = config.get("max_tokens", 512)
    system_prefix = config.get("system_prefix", "")

    # Build the prompt with context
    context = config.get("context", {})
    augmenter = QueryAugmenter()
    if context:
        full_prompt = augmenter.build_prompt_prefix(query, context)
    else:
        full_prompt = query

    # Simulate answer generation
    # In production: call mellum2 or mercury2 API
    # Here: produce a structured placeholder that indicates the call would happen
    answer_parts: List[str] = []

    if system_prefix:
        answer_parts.append(f"[System: {system_prefix}]")

    # Determine query intent for answer construction
    classification = augmenter.is_factual(query)
    if classification:
        answer_parts.append(
            f"Based on available knowledge: {query.strip('?').strip()}"
        )
    else:
        answer_parts.append(
            f"Analysis of: {query.strip()}"
        )

    # Add context-derived info if available
    if context.get("graph_facts"):
        facts = context["graph_facts"]
        answer_parts.append(f"Graph-grounded facts: {'; '.join(facts[:3])}")

    if context.get("entities"):
        entities = context["entities"]
        answer_parts.append(f"Entities referenced: {', '.join(entities[:5])}")

    answer = " | ".join(answer_parts)

    # Estimate token usage
    prompt_tokens = len(full_prompt.split()) * 1.3  # rough estimate
    completion_tokens = min(max_tokens, len(answer.split()) * 1.5)
    total_tokens = int(prompt_tokens + completion_tokens)

    # Confidence estimation
    confidence = 0.7  # default LLM confidence
    temperature = config.get("temperature", 0.7)
    if temperature < 0.3:
        confidence = 0.9  # low temperature = more deterministic
    elif temperature > 0.9:
        confidence = 0.5  # high temperature = more variable

    return PromptResult(
        answer=answer,
        tokens_used=total_tokens,
        confidence=confidence,
        model=model,
    )


# ---------------------------------------------------------------------------
# DualBrainRouter
# ---------------------------------------------------------------------------

class DualBrainRouter:
    """Central routing coordinator for the DualBrain inference layer.

    Decides how to process each query through three modes:

    - **GRAPH**:  Deterministic graph traversal.  Fast, no LLM, high
      precision for factual lookups.
    - **PROMPT**: LLM-based generation.  Creative, flexible, higher
      latency and token cost.
    - **HYBRID**: Graph first, then prompt augmentation.  Best of both
      worlds: graph-grounded facts + LLM reasoning.

    Integrates with the Ava007Orchestrator's three-tier system:

    - **Reflex**: The router itself acts as the reflex layer — fast
      classification and routing.
    - **Executive**: PROMPT mode delegates to mellum2 (executive LLM).
    - **Cortex**: HYBRID mode delegates to mercury2 (cortex LLM) for
      synthesis after graph retrieval.

    Usage::

        router = DualBrainRouter()
        decision = router.route("What is the status of deployment?")
        if decision.mode == "GRAPH":
            result = router.execute_graph("What is the status?", graph_data)
        elif decision.mode == "PROMPT":
            result = router.execute_prompt("Explain the deployment process")
        elif decision.mode == "HYBRID":
            result = router.execute_hybrid("Compare deployment strategies", ...)
    """

    def __init__(self,
                 strategy: RoutingStrategy = RoutingStrategy.BALANCED,
                 routing_engine: Optional[RoutingEngine] = None,
                 augmenter: Optional[QueryAugmenter] = None,
                 graph_executor: Optional[Callable] = None,
                 prompt_executor: Optional[Callable] = None) -> None:
        """Initialise the DualBrain router.

        Args:
            strategy:         Default routing strategy.
            routing_engine:   Custom RoutingEngine instance (created if None).
            augmenter:        Custom QueryAugmenter instance (created if None).
            graph_executor:   Custom graph execution callable.  Signature:
                              ``(query: str, graph_data: Optional[dict]) -> GraphResult``
                              If None, the built-in ``_traverse_graph`` is used.
            prompt_executor:  Custom prompt execution callable.  Signature:
                              ``(query: str, prompt_config: Optional[dict]) -> PromptResult``
                              If None, the built-in ``_generate_prompt`` is used.
        """
        self._strategy = strategy
        self._routing_engine = routing_engine or RoutingEngine(strategy=strategy)
        self._augmenter = augmenter or QueryAugmenter()
        self._graph_executor = graph_executor or _traverse_graph
        self._prompt_executor = prompt_executor or _generate_prompt

        # Routing history for telemetry
        self._history: List[dict] = []

    # -- Public API ----------------------------------------------------------

    def route(self, query: str,
              context: Optional[RoutingContext] = None) -> RoutingDecision:
        """Route a query to the appropriate processing mode.

        This is the main entry point.  It:

        1. Classifies the query (factual / analytical / creative / mixed)
        2. Computes routing confidence based on query and context
        3. Decides the routing mode (GRAPH / PROMPT / HYBRID)
        4. Estimates latency and token budget
        5. Returns a ``RoutingDecision``

        Args:
            query:   The user query string.
            context: Optional routing context with prior confidence,
                     importance, source, etc.

        Returns:
            A ``RoutingDecision`` with mode, confidence, reason,
            estimated latency, and token budget.
        """
        t0 = time.monotonic()

        ctx = context or RoutingContext()

        # Step 1: Classify
        classification = self._routing_engine.classify_query(query)

        # Step 2: Compute confidence
        confidence = self._routing_engine.compute_confidence(query, ctx)

        # Step 3: Decide route
        mode = self._routing_engine.decide_route(
            classification, confidence, self._strategy
        )

        # Step 4: Estimate latency and token budget
        latency = self._routing_engine.estimate_latency(mode, ctx)
        token_budget = self._routing_engine.estimate_token_budget(mode, ctx)

        # Build reason string
        reason = self._build_reason(classification, confidence, mode, ctx)

        # Record in history
        self._history.append({
            "query": query[:200],
            "classification": classification.type,
            "confidence": confidence,
            "mode": mode.value,
            "reason": reason,
            "latency_ms": latency,
            "timestamp": time.time(),
        })

        decision = RoutingDecision(
            mode=mode.value,
            confidence=confidence,
            reason=reason,
            estimated_latency_ms=latency,
            token_budget=token_budget,
        )

        return decision

    def execute_graph(self, query: str,
                      graph_data: Optional[dict] = None) -> GraphResult:
        """Execute a query in GRAPH mode (deterministic graph traversal).

        Performs graph traversal on *graph_data* to answer *query*.  If
        *graph_data* is None, returns an empty result with low confidence.

        The graph executor also uses the QueryAugmenter to extract
        entities and match them against graph nodes for more precise
        retrieval.

        Args:
            query:      The user query.
            graph_data: Graph data dictionary with nodes and edges.

        Returns:
            A ``GraphResult`` with the graph-derived answer, paths,
            confidence, and source nodes.
        """
        t0 = time.monotonic()

        # Extract entities for potential graph matching
        entities = self._augmenter.extract_entities(query)

        # Execute graph traversal
        result = self._graph_executor(query, graph_data)

        # If we have entities but no result, try entity-based lookup
        if not result.answer and entities and graph_data:
            # Build a focused query from entities
            focused_query = " ".join(entities)
            result = self._graph_executor(focused_query, graph_data)

        return result

    def execute_prompt(self, query: str,
                       prompt_config: Optional[dict] = None) -> PromptResult:
        """Execute a query in PROMPT mode (LLM generation).

        Constructs a prompt with optional augmentation context and sends
        it to the LLM executor (mellum2 for executive, mercury2 for
        cortex).

        If *prompt_config* is None, default configuration is used:

        - ``"model"``: ``"mellum2"`` (executive tier)
        - ``"max_tokens"``: 512
        - ``"temperature"``: 0.7

        Args:
            query:         The user query.
            prompt_config: Optional LLM configuration.

        Returns:
            A ``PromptResult`` with the LLM-generated answer, token
            usage, confidence, and model identifier.
        """
        config = prompt_config or {}

        # Build context for the augmenter
        context_dict: Dict[str, Any] = {}

        # Add entity grounding
        entities = self._augmenter.extract_entities(query)
        if entities:
            context_dict["entities"] = entities

        # Add factual grounding hint
        if self._augmenter.is_factual(query):
            context_dict["role"] = "factual_retrieval_assistant"
        else:
            context_dict["role"] = "analytical_assistant"

        # Merge with provided config context
        provided_context = config.get("context", {})
        context_dict.update(provided_context)

        # Set config context
        config["context"] = context_dict

        # Execute prompt
        result = self._prompt_executor(query, config)

        return result

    def execute_hybrid(self, query: str,
                       graph_data: Optional[dict] = None,
                       prompt_config: Optional[dict] = None) -> HybridResult:
        """Execute a query in HYBRID mode (graph first, prompt augment).

        Two-phase execution:

        1. **GRAPH phase**: Traverse the graph to get factual context.
        2. **PROMPT phase**: If the graph answer is insufficient
           (confidence < 0.5) or contradictions are detected, invoke
           the LLM with the graph context as grounding.

        The final answer is constructed by:

        - If graph confidence >= 0.8 and no contradictions → use
          graph answer directly (no LLM call needed)
        - If graph confidence >= 0.5 → merge graph + prompt answers
        - If graph confidence < 0.5 → primarily use prompt answer
          with graph context as background

        Contradictions between graph and prompt answers are detected
        and logged.

        Args:
            query:          The user query.
            graph_data:     Graph data dictionary.
            prompt_config:  Optional LLM configuration.

        Returns:
            A ``HybridResult`` with both phase results, the final
            answer, and overall confidence.
        """
        # Phase 1: Graph execution
        graph_result = self.execute_graph(query, graph_data)

        # Decide if PROMPT phase is needed
        needs_prompt = graph_result.confidence < 0.8

        prompt_result: Optional[PromptResult] = None
        contradictions: List[Contradiction] = []

        if needs_prompt:
            # Augment prompt config with graph context
            config = dict(prompt_config or {})
            context_dict: Dict[str, Any] = config.get("context", {})

            # Add graph facts as grounding
            if graph_result.answer:
                context_dict.setdefault("graph_facts", []).append(
                    graph_result.answer
                )
            if graph_result.source_nodes:
                context_dict["entities"] = list(set(
                    context_dict.get("entities", [])
                    + graph_result.source_nodes
                ))

            config["context"] = context_dict

            # Phase 2: Prompt execution
            prompt_result = self.execute_prompt(query, config)

            # Detect contradictions
            if graph_result.answer and prompt_result.answer:
                contradictions = self._augmenter.detect_contradictions(
                    graph_result.answer, prompt_result.answer
                )

        # Construct final answer
        final_answer, overall_confidence = self._merge_results(
            query, graph_result, prompt_result, contradictions
        )

        return HybridResult(
            graph_result=graph_result,
            prompt_result=prompt_result,
            final_answer=final_answer,
            confidence=overall_confidence,
            mode="HYBRID",
        )

    def set_routing_strategy(self, strategy: RoutingStrategy) -> None:
        """Change the active routing strategy.

        This affects all subsequent ``route()`` calls.  The routing
        engine's strategy is also updated.

        Args:
            strategy: The new routing strategy.
        """
        self._strategy = strategy
        self._routing_engine.strategy = strategy

    # -- Telemetry and introspection -----------------------------------------

    @property
    def routing_history(self) -> List[dict]:
        """Return a copy of the routing history."""
        return list(self._history)

    @property
    def strategy(self) -> RoutingStrategy:
        """Return the current routing strategy."""
        return self._strategy

    def clear_history(self) -> None:
        """Clear the routing history."""
        self._history.clear()

    # -- Private helpers -----------------------------------------------------

    def _build_reason(self,
                      classification: QueryClassification,
                      confidence: float,
                      mode: RoutingMode,
                      context: RoutingContext) -> str:
        """Build a human-readable reason string for the routing decision."""
        parts: List[str] = []

        # Classification-based reason
        ctype = classification.type
        if ctype == "factual":
            parts.append("Factual query → GRAPH preferred")
        elif ctype == "creative":
            parts.append("Creative query → PROMPT preferred")
        elif ctype == "analytical":
            parts.append("Analytical query → HYBRID preferred")
        elif ctype == "mixed":
            parts.append("Mixed query → HYBRID for comprehensive coverage")

        # Confidence-based reason
        if confidence < 0.3:
            parts.append("low confidence (%.2f)" % confidence)
        elif confidence < 0.7:
            parts.append("moderate confidence (%.2f)" % confidence)
        else:
            parts.append("high confidence (%.2f)" % confidence)

        # Context-based reason
        if context.available_graph_nodes == 0:
            parts.append("no graph nodes available")
        if context.has_policy_conflicts:
            parts.append("policy conflicts detected")
        if classification.requires_reasoning:
            parts.append("multi-step reasoning required")

        # Mode decision
        parts.append(f"→ {mode.value}")

        return "; ".join(parts)

    def _merge_results(self,
                       query: str,
                       graph_result: GraphResult,
                       prompt_result: Optional[PromptResult],
                       contradictions: List[Contradiction]) -> tuple:
        """Merge graph and prompt results into a final answer.

        Returns:
            A tuple of (final_answer: str, overall_confidence: float).
        """
        g_conf = graph_result.confidence
        g_answer = graph_result.answer

        # If no prompt result, use graph answer
        if prompt_result is None:
            return g_answer, g_conf

        p_conf = prompt_result.confidence
        p_answer = prompt_result.answer

        # High-confidence graph, no contradictions → trust graph
        if g_conf >= 0.8 and not contradictions:
            final = f"{g_answer}"
            if p_answer:
                final += f"\n\n[LLM supplement: {p_answer}]"
            confidence = g_conf * 0.8 + p_conf * 0.2

        # Moderate graph confidence → weighted merge
        elif g_conf >= 0.5:
            # Weight graph higher for factual, prompt higher for reasoning
            is_factual = self._augmenter.is_factual(query)
            if is_factual:
                g_weight, p_weight = 0.7, 0.3
            else:
                g_weight, p_weight = 0.4, 0.6

            confidence = g_conf * g_weight + p_conf * p_weight

            # If contradictions, note them
            if contradictions:
                high_severity = any(c.severity == "high" for c in contradictions)
                if high_severity:
                    # Trust graph for factual contradictions
                    final = (
                        f"[Graph-verified]: {g_answer}\n\n"
                        f"[LLM perspective]: {p_answer}\n\n"
                        f"⚠ Contradictions detected ({len(contradictions)}). "
                        f"Graph answer preferred for factual accuracy."
                    )
                    confidence = max(0.0, confidence - 0.15)
                else:
                    final = (
                        f"[Graph context]: {g_answer}\n\n"
                        f"[LLM synthesis]: {p_answer}\n\n"
                        f"Note: {len(contradictions)} minor discrepancy/ies noted."
                    )
            else:
                final = (
                    f"[Graph context]: {g_answer}\n\n"
                    f"[LLM synthesis]: {p_answer}"
                )

        # Low graph confidence → primarily prompt
        else:
            confidence = p_conf * 0.7 + g_conf * 0.3
            if g_answer:
                final = (
                    f"{p_answer}\n\n"
                    f"[Background from graph]: {g_answer}"
                )
            else:
                final = p_answer

            if contradictions:
                final += (
                    f"\n\n⚠ {len(contradictions)} contradiction(s) between "
                    f"graph and LLM. Verify critical claims."
                )
                confidence = max(0.0, confidence - 0.1)

        return final, max(0.0, min(1.0, confidence))
