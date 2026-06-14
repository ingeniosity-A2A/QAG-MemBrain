"""
routing.py — Confidence-Threshold Routing Engine for QAG-MemBrain DualBrain (L6).

Implements the routing decision layer that classifies queries and decides
whether to use GRAPH (deterministic graph traversal), PROMPT (LLM generation),
or HYBRID (graph first, then prompt augmentation).

Three routing strategies:
    CONSERVATIVE — prefer GRAPH; high threshold (0.7) for PROMPT
    BALANCED     — default strategy; moderate threshold (0.5)
    AGGRESSIVE   — prefer PROMPT; low threshold (0.3)

Core classes:
    RoutingEngine       — Classification + routing decision engine
    QueryClassification — Query type classification result
    RoutingStrategy     — Strategy enum
    RoutingMode         — Output mode enum
    RoutingContext      — Input context for routing decisions
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Set


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class RoutingStrategy(Enum):
    """Routing strategy controlling confidence thresholds and mode bias.

    Each strategy defines a *prompt_threshold* — the confidence level
    above which PROMPT mode is preferred over GRAPH.  Below this
    threshold, GRAPH mode is used.  HYBRID is selected for queries
    that are partially factual and partially creative/analytical.
    """
    CONSERVATIVE = "conservative"   # Prefer GRAPH; threshold 0.7
    BALANCED = "balanced"           # Default; threshold 0.5
    AGGRESSIVE = "aggressive"       # Prefer PROMPT; threshold 0.3


class RoutingMode(Enum):
    """Output routing mode decided by the routing engine."""
    GRAPH = "GRAPH"       # Deterministic graph traversal
    PROMPT = "PROMPT"     # LLM-based generation
    HYBRID = "HYBRID"     # Graph first, prompt augmentation


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class QueryClassification:
    """Result of classifying a query by type.

    Attributes:
        type:              One of ``"factual"``, ``"analytical"``,
                           ``"creative"``, or ``"mixed"``.
        keywords:          Significant keywords extracted from the query.
        has_entity:        Whether named entities were detected.
        requires_reasoning: Whether the query likely needs multi-step
                           reasoning (inference, comparison, synthesis).
    """
    type: str  # "factual" | "analytical" | "creative" | "mixed"
    keywords: List[str] = field(default_factory=list)
    has_entity: bool = False
    requires_reasoning: bool = False


@dataclass
class RoutingContext:
    """Input context for routing decisions.

    Attributes:
        confidence:           Prior confidence score [0.0, 1.0] from
                              upstream processing.
        importance:           Importance level (``"low"``, ``"medium"``,
                              ``"high"``, ``"critical"``).
        source:               Origin of the query (``"reflex"``,
                              ``"executive"``, ``"cortex"``, ``"user"``,
                              etc.).
        query_type:           Hint from upstream about query type
                              (``"lookup"``, ``"generation"``,
                              ``"analysis"``, ``"unknown"``).
        available_graph_nodes: Number of graph nodes available for
                               retrieval.  0 means graph is empty.
        has_policy_conflicts: Whether policy evaluation found conflicts.
    """
    confidence: float = 0.5
    importance: str = "medium"
    source: str = "user"
    query_type: str = "unknown"
    available_graph_nodes: int = 0
    has_policy_conflicts: bool = False


# ---------------------------------------------------------------------------
# Strategy thresholds
# ---------------------------------------------------------------------------

_STRATEGY_THRESHOLDS: Dict[RoutingStrategy, float] = {
    RoutingStrategy.CONSERVATIVE: 0.7,
    RoutingStrategy.BALANCED: 0.5,
    RoutingStrategy.AGGRESSIVE: 0.3,
}

# Token budgets per mode and importance level
_TOKEN_BUDGETS: Dict[str, Dict[str, int]] = {
    "GRAPH": {"low": 0, "medium": 0, "high": 0, "critical": 0},
    "PROMPT": {"low": 256, "medium": 512, "high": 1024, "critical": 2048},
    "HYBRID": {"low": 128, "medium": 384, "high": 768, "critical": 1536},
}

# Base latency estimates (ms) per mode
_BASE_LATENCY: Dict[str, float] = {
    "GRAPH": 5.0,      # Graph traversal is fast
    "PROMPT": 800.0,    # LLM call is slow
    "HYBRID": 850.0,    # Graph + LLM
}


# ---------------------------------------------------------------------------
# Keyword extraction and classification helpers
# ---------------------------------------------------------------------------

_STOPWORDS: Set[str] = frozenset({
    "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "shall", "can", "not", "no", "but", "or",
    "and", "if", "then", "than", "so", "as", "by", "for", "with", "about",
    "against", "between", "through", "during", "before", "after", "above",
    "below", "to", "from", "up", "down", "in", "out", "on", "off", "over",
    "under", "again", "further", "that", "this", "these", "those", "it",
    "its", "of", "at", "which", "what", "who", "whom", "how", "why",
    "when", "where", "there", "here", "all", "each", "every", "both",
    "few", "more", "most", "other", "some", "such", "only", "own", "same",
    "too", "very", "just", "also", "much", "many", "any",
})

# Factual query patterns
_FACTUAL_PATTERNS: List[re.Pattern] = [
    re.compile(r"\b(who|what|when|where|how many|how much|how old|which)\b", re.I),
    re.compile(r"\b(definition|meaning|capital|population|status|value|location)\s+of\b", re.I),
    re.compile(r"\b(is there|does .+ have|list all|show me|find the)\b", re.I),
    re.compile(r"^(is|are|was|were|does|do|did|has|have|had)\b", re.I),
]

# Analytical query patterns
_ANALYTICAL_PATTERNS: List[re.Pattern] = [
    re.compile(r"\b(why|how does|explain|analyze|compare|contrast|evaluate)\b", re.I),
    re.compile(r"\b(cause|reason|impact|effect|consequence|implication)\b", re.I),
    re.compile(r"\b(difference between|relationship between|correlation)\b", re.I),
    re.compile(r"\b(pros and cons|advantages|disadvantages|trade.?off)\b", re.I),
]

# Creative query patterns
_CREATIVE_PATTERNS: List[re.Pattern] = [
    re.compile(r"\b(create|generate|design|compose|write|imagine|invent|propose)\b", re.I),
    re.compile(r"\b(suggest|recommend|brainstorm|ideate|draft|craft)\b", re.I),
    re.compile(r"\b(story|poem|essay|narrative|scenario|hypothetical)\b", re.I),
    re.compile(r"\b(what if|suppose|envision|speculate)\b", re.I),
]

# Entity detection patterns
_ENTITY_RE = re.compile(
    r"\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b"  # Multi-word capitalised
)
_QUOTED_ENTITY_RE = re.compile(r'["\u201c\u201d]([^"\u201c\u201d]+)["\u201c\u201d]')

# Reasoning indicator patterns
_REASONING_PATTERNS: List[re.Pattern] = [
    re.compile(r"\b(therefore|thus|hence|consequently|because|since)\b", re.I),
    re.compile(r"\b(infer|deduce|conclude|derive|reason|logically)\b", re.I),
    re.compile(r"\b(if .+ then|assuming|given that|based on)\b", re.I),
    re.compile(r"\b(compare|contrast|weigh|balance|prioritize)\b", re.I),
]


def _extract_keywords(query: str) -> List[str]:
    """Extract significant keywords from *query*, excluding stopwords."""
    tokens = re.findall(r"\b[A-Za-z][A-Za-z0-9_]{2,}\b", query)
    keywords = [t for t in tokens if t.lower() not in _STOPWORDS]
    # Deduplicate preserving order
    seen: Set[str] = set()
    result: List[str] = []
    for kw in keywords:
        kl = kw.lower()
        if kl not in seen:
            seen.add(kl)
            result.append(kw)
    return result


def _detect_entities(query: str) -> bool:
    """Return True if named entities are detected in *query*."""
    if _ENTITY_RE.search(query):
        return True
    if _QUOTED_ENTITY_RE.search(query):
        return True
    return False


def _requires_reasoning(query: str) -> bool:
    """Return True if *query* likely requires multi-step reasoning."""
    for pattern in _REASONING_PATTERNS:
        if pattern.search(query):
            return True
    return False


def _count_pattern_matches(query: str, patterns: List[re.Pattern]) -> int:
    """Count how many of *patterns* match in *query*."""
    return sum(1 for p in patterns if p.search(query))


# ---------------------------------------------------------------------------
# RoutingEngine
# ---------------------------------------------------------------------------

class RoutingEngine:
    """Confidence-threshold routing engine for the DualBrain layer.

    Classifies queries by type (factual / analytical / creative / mixed)
    and decides the routing mode (GRAPH / PROMPT / HYBRID) based on
    classification, confidence, and the active strategy.

    Routing logic:

    - **Factual** queries → GRAPH preferred (deterministic, fast, no LLM)
    - **Analytical** queries → HYBRID (graph for facts, prompt for
      reasoning)
    - **Creative** queries → PROMPT preferred (LLM generation)
    - **Mixed** queries → HYBRID (graph + prompt)

    The strategy adjusts the confidence threshold at which PROMPT mode
    is preferred over GRAPH.

    Usage::

        engine = RoutingEngine()
        cls = engine.classify_query("What is the capital of France?")
        confidence = engine.compute_confidence("What is the capital?", ctx)
        mode = engine.decide_route(cls, confidence, RoutingStrategy.BALANCED)
    """

    def __init__(self,
                 strategy: RoutingStrategy = RoutingStrategy.BALANCED,
                 hybrid_on_mixed: bool = True,
                 graph_boost_on_entities: float = 0.15,
                 prompt_boost_on_creative: float = 0.15) -> None:
        """Initialise the routing engine.

        Args:
            strategy:               Default routing strategy.
            hybrid_on_mixed:        If True, mixed queries always use HYBRID.
            graph_boost_on_entities: Confidence boost when entities match
                                     graph nodes.
            prompt_boost_on_creative: Confidence boost for creative queries
                                      (shifts them toward PROMPT).
        """
        self.strategy = strategy
        self.hybrid_on_mixed = hybrid_on_mixed
        self.graph_boost_on_entities = graph_boost_on_entities
        self.prompt_boost_on_creative = prompt_boost_on_creative

    # -- Query classification -------------------------------------------------

    def classify_query(self, query: str) -> QueryClassification:
        """Classify *query* by type.

        The classification uses regex pattern matching against three
        categories (factual, analytical, creative).  The category with
        the most pattern matches wins.  If two or more categories have
        equal non-zero counts, the type is ``"mixed"``.  If no category
        matches, the query is classified based on heuristic rules:

        - Short queries (< 6 words) default to ``"factual"``
        - Questions starting with "how" or "why" → ``"analytical"``
        - Everything else → ``"analytical"`` (safe default for
          non-trivial queries)

        Args:
            query: The raw query string.

        Returns:
            A ``QueryClassification`` with type, keywords, entity flag,
            and reasoning flag.
        """
        if not query or not query.strip():
            return QueryClassification(
                type="factual",
                keywords=[],
                has_entity=False,
                requires_reasoning=False,
            )

        q = query.strip()
        keywords = _extract_keywords(q)
        has_entity = _detect_entities(q)
        requires_reasoning = _requires_reasoning(q)

        # Count pattern matches for each category
        factual_count = _count_pattern_matches(q, _FACTUAL_PATTERNS)
        analytical_count = _count_pattern_matches(q, _ANALYTICAL_PATTERNS)
        creative_count = _count_pattern_matches(q, _CREATIVE_PATTERNS)

        # Determine dominant type
        scores = {
            "factual": factual_count,
            "analytical": analytical_count,
            "creative": creative_count,
        }

        max_score = max(scores.values())

        if max_score == 0:
            # No pattern matched — use heuristics
            word_count = len(q.split())
            if word_count < 6:
                qtype = "factual"
            elif q.lower().startswith("how") or q.lower().startswith("why"):
                qtype = "analytical"
            else:
                qtype = "analytical"
        else:
            # Find categories with max score
            top_cats = [cat for cat, score in scores.items()
                        if score == max_score]
            if len(top_cats) > 1:
                qtype = "mixed"
            else:
                qtype = top_cats[0]

        # Check for mixed: if two or more categories have non-zero scores
        non_zero_cats = [cat for cat, score in scores.items() if score > 0]
        if len(non_zero_cats) >= 2:
            qtype = "mixed"

        return QueryClassification(
            type=qtype,
            keywords=keywords,
            has_entity=has_entity,
            requires_reasoning=requires_reasoning,
        )

    # -- Confidence computation -----------------------------------------------

    def compute_confidence(self, query: str,
                           context: RoutingContext) -> float:
        """Compute routing confidence for *query* given *context*.

        The confidence score is a blend of:

        1. **Base confidence** from ``context.confidence`` (0.0-1.0)
        2. **Graph availability boost**: +0.1 if ``available_graph_nodes``
           > 0 and the query has entities
        3. **Policy conflict penalty**: -0.1 if ``has_policy_conflicts``
           is True (lower confidence → safer routing)
        4. **Classification alignment**: queries that match their
           preferred mode get +0.05

        The result is clamped to [0.0, 1.0].

        Args:
            query:   The raw query string.
            context: Routing context with prior confidence and metadata.

        Returns:
            A confidence value in [0.0, 1.0].
        """
        base = context.confidence
        classification = self.classify_query(query)

        # Graph availability boost
        if context.available_graph_nodes > 0 and classification.has_entity:
            base += self.graph_boost_on_entities

        # Policy conflict penalty
        if context.has_policy_conflicts:
            base -= 0.1

        # Classification alignment boost
        if classification.type == "factual" and context.available_graph_nodes > 0:
            base += 0.05
        elif classification.type == "creative" and context.source in ("cortex", "executive"):
            base += 0.05

        # Importance modifier
        importance_mod = {
            "low": -0.05,
            "medium": 0.0,
            "high": 0.05,
            "critical": 0.1,
        }.get(context.importance, 0.0)
        base += importance_mod

        # Clamp
        return max(0.0, min(1.0, base))

    # -- Routing decision -----------------------------------------------------

    def decide_route(self, classification: QueryClassification,
                     confidence: float,
                     strategy: Optional[RoutingStrategy] = None) -> RoutingMode:
        """Decide the routing mode based on classification, confidence,
        and strategy.

        Decision matrix:

        - **Factual** queries → GRAPH (always, regardless of confidence)
        - **Creative** queries → PROMPT (if confidence ≥ threshold)
        - **Analytical** queries → HYBRID (if graph available),
          otherwise PROMPT
        - **Mixed** queries → HYBRID (if ``hybrid_on_mixed``), otherwise
          based on confidence threshold

        The *strategy* determines the confidence threshold for PROMPT:

        - CONSERVATIVE: 0.7
        - BALANCED: 0.5
        - AGGRESSIVE: 0.3

        Args:
            classification: Query classification result.
            confidence:     Computed confidence score.
            strategy:       Override strategy (uses default if None).

        Returns:
            The decided ``RoutingMode``.
        """
        strat = strategy or self.strategy
        threshold = _STRATEGY_THRESHOLDS[strat]

        qtype = classification.type

        # Factual → always GRAPH (deterministic)
        if qtype == "factual":
            # But if confidence is very low (< 0.2), the graph may not
            # have the answer → HYBRID for safety
            if confidence < 0.2:
                return RoutingMode.HYBRID
            return RoutingMode.GRAPH

        # Creative → PROMPT preferred
        if qtype == "creative":
            if confidence >= threshold:
                return RoutingMode.PROMPT
            # Low confidence creative → HYBRID (use graph for grounding)
            return RoutingMode.HYBRID

        # Analytical → HYBRID (graph for facts, prompt for reasoning)
        if qtype == "analytical":
            if classification.requires_reasoning:
                return RoutingMode.HYBRID
            # Simple analytical with high confidence → GRAPH may suffice
            if confidence >= threshold:
                return RoutingMode.HYBRID
            return RoutingMode.GRAPH

        # Mixed → HYBRID
        if qtype == "mixed":
            if self.hybrid_on_mixed:
                return RoutingMode.HYBRID
            # Fall through to confidence-based decision
            if confidence >= threshold:
                return RoutingMode.PROMPT
            return RoutingMode.GRAPH

        # Default: confidence-based
        if confidence >= threshold:
            return RoutingMode.PROMPT
        return RoutingMode.GRAPH

    # -- Latency estimation ---------------------------------------------------

    def estimate_latency(self, mode: RoutingMode,
                         context: RoutingContext) -> float:
        """Estimate latency in milliseconds for a given routing mode.

        Estimation factors:

        - **Base latency**: GRAPH ~5ms, PROMPT ~800ms, HYBRID ~850ms
        - **Graph depth factor**: +2ms per 100 graph nodes (for GRAPH
          and HYBRID modes)
        - **Policy conflict factor**: +50ms for PROMPT/HYBRID if
          ``has_policy_conflicts`` (extra validation)
        - **Importance factor**: critical queries add +100ms for
          PROMPT/HYBRID (thoroughness)

        Args:
            mode:    The routing mode to estimate for.
            context: Routing context.

        Returns:
            Estimated latency in milliseconds.
        """
        mode_key = mode.value
        base = _BASE_LATENCY.get(mode_key, 500.0)

        # Graph depth factor
        if mode in (RoutingMode.GRAPH, RoutingMode.HYBRID):
            graph_nodes = context.available_graph_nodes
            base += (graph_nodes / 100.0) * 2.0

        # Policy conflict factor
        if context.has_policy_conflicts and mode in (
            RoutingMode.PROMPT, RoutingMode.HYBRID
        ):
            base += 50.0

        # Importance factor
        if context.importance == "critical" and mode in (
            RoutingMode.PROMPT, RoutingMode.HYBRID
        ):
            base += 100.0

        return base

    # -- Token budget estimation ----------------------------------------------

    def estimate_token_budget(self, mode: RoutingMode,
                              context: RoutingContext) -> int:
        """Estimate the token budget for a given routing mode.

        Token budgets by mode and importance:

        - **GRAPH**: always 0 (no LLM tokens needed)
        - **PROMPT**: 256 (low) → 2048 (critical)
        - **HYBRID**: 128 (low) → 1536 (critical)

        Args:
            mode:    The routing mode to estimate for.
            context: Routing context.

        Returns:
            Token budget (integer).
        """
        mode_key = mode.value
        importance = context.importance

        budget_map = _TOKEN_BUDGETS.get(mode_key, _TOKEN_BUDGETS["PROMPT"])
        budget = budget_map.get(importance, budget_map["medium"])

        # If policy conflicts, reserve 10% of budget for policy validation
        if context.has_policy_conflicts and budget > 0:
            budget = int(budget * 0.9)

        # Strategy adjustment
        if self.strategy == RoutingStrategy.AGGRESSIVE and budget > 0:
            budget = int(budget * 1.2)  # 20% more for aggressive
        elif self.strategy == RoutingStrategy.CONSERVATIVE and budget > 0:
            budget = int(budget * 0.8)  # 20% less for conservative

        return budget
