"""
response_generator.py — Response Generation for QAG-MemBrain Pipeline (Layer 7).

Generates structured responses from pipeline data, supporting graph-based,
prompt-based, and hybrid answer modes with citation tracking, confidence
assessment, and multiple merge strategies.

Merge strategies
----------------
- 'graph_priority'    : use graph answer if available, fall back to prompt
- 'prompt_priority'   : use prompt answer, augment with graph context
- 'weighted'          : combine both with configurable weights
- 'contradiction_check': flag contradictions between graph and prompt answers
"""

from __future__ import annotations

import hashlib
import json
import re
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class Citation:
    """A citation referencing a source node or document.

    Attributes:
        source_id:   Unique identifier of the source.
        source_type: Type of source (e.g. 'graph_node', 'document', 'cache').
        relevance:   Relevance score in [0.0, 1.0].
        excerpt:     Short text excerpt from the source.
    """
    source_id: str
    source_type: str
    relevance: float
    excerpt: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "source_id": self.source_id,
            "source_type": self.source_type,
            "relevance": self.relevance,
            "excerpt": self.excerpt,
        }


@dataclass
class GeneratedResponse:
    """Structured response produced by the response generator.

    Attributes:
        answer:     The generated answer text.
        confidence: Overall confidence score in [0.0, 1.0].
        citations:  List of citations backing the answer.
        mode:       Generation mode ('graph', 'prompt', 'hybrid').
        metadata:   Additional metadata (timing, strategy, etc.).
    """
    answer: str
    confidence: float
    citations: List[Citation] = field(default_factory=list)
    mode: str = "graph"
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "answer": self.answer,
            "confidence": self.confidence,
            "citations": [c.to_dict() for c in self.citations],
            "mode": self.mode,
            "metadata": self.metadata,
        }


# ---------------------------------------------------------------------------
# Contradiction detection helpers
# ---------------------------------------------------------------------------

def _tokenize(text: str) -> set:
    """Simple whitespace + punctuation tokenizer for comparison."""
    return set(re.findall(r"[a-zA-Z0-9]+", text.lower()))


def _sentence_overlap(sent_a: str, sent_b: str) -> float:
    """Jaccard-like token overlap ratio between two sentences."""
    tokens_a = _tokenize(sent_a)
    tokens_b = _tokenize(sent_b)
    if not tokens_a or not tokens_b:
        return 0.0
    return len(tokens_a & tokens_b) / len(tokens_a | tokens_b)


def _split_sentences(text: str) -> List[str]:
    """Split text into sentences on .!? boundaries."""
    sentences = re.split(r'(?<=[.!?])\s+', text.strip())
    return [s.strip() for s in sentences if s.strip()]


def _detect_contradictions(graph_answer: str, prompt_answer: str) -> List[Dict[str, Any]]:
    """Detect potential contradictions between two answers.

    Uses a heuristic approach: for each sentence pair across the two answers,
    if they share significant token overlap but contain negation or opposing
    language, flag as a contradiction.
    """
    contradictions: List[Dict[str, Any]] = []
    negation_patterns = [
        r"\bnot\b", r"\bno\b", r"\bnever\b", r"\bnone\b",
        r"\bcannot\b", r"\bcan't\b", r"\bdon't\b", r"\bdoesn't\b",
        r"\bisn't\b", r"\baren't\b", r"\bwon't\b", r"\bwouldn't\b",
        r"\bshouldn't\b", r"\bimpossible\b", r"\bfalse\b", r"\bincorrect\b",
    ]

    graph_sents = _split_sentences(graph_answer)
    prompt_sents = _split_sentences(prompt_answer)

    for g_sent in graph_sents:
        for p_sent in prompt_sents:
            overlap = _sentence_overlap(g_sent, p_sent)
            if overlap < 0.3:
                continue
            # Check if one has negation and the other doesn't
            g_has_negation = any(re.search(p, g_sent, re.IGNORECASE)
                                 for p in negation_patterns)
            p_has_negation = any(re.search(p, p_sent, re.IGNORECASE)
                                 for p in negation_patterns)

            if g_has_negation != p_has_negation:
                contradictions.append({
                    "graph_sentence": g_sent,
                    "prompt_sentence": p_sent,
                    "overlap": overlap,
                    "type": "negation_conflict",
                })

    return contradictions


# ---------------------------------------------------------------------------
# ResponseGenerator
# ---------------------------------------------------------------------------

class ResponseGenerator:
    """Generates structured responses from pipeline data.

    Supports graph-based, prompt-based, and hybrid modes with multiple
    merge strategies for combining answers from different sources.

    Parameters
    ----------
    graph_weight : float
        Weight for graph answer in 'weighted' merge strategy (default 0.6).
    prompt_weight : float
        Weight for prompt answer in 'weighted' merge strategy (default 0.4).
    contradiction_threshold : float
        Minimum token overlap to consider for contradiction detection
        (default 0.3).
    """

    def __init__(
        self,
        graph_weight: float = 0.6,
        prompt_weight: float = 0.4,
        contradiction_threshold: float = 0.3,
    ) -> None:
        if not 0.0 <= graph_weight <= 1.0:
            raise ValueError("graph_weight must be in [0.0, 1.0]")
        if not 0.0 <= prompt_weight <= 1.0:
            raise ValueError("prompt_weight must be in [0.0, 1.0]")
        if not 0.0 <= contradiction_threshold <= 1.0:
            raise ValueError("contradiction_threshold must be in [0.0, 1.0]")

        self._graph_weight = graph_weight
        self._prompt_weight = prompt_weight
        self._contradiction_threshold = contradiction_threshold

    # ------------------------------------------------------------------
    # Core generation
    # ------------------------------------------------------------------

    def generate(
        self,
        retrieval_result: Optional[Dict[str, Any]] = None,
        prompt_result: Optional[Dict[str, Any]] = None,
        mode: str = "graph",
    ) -> GeneratedResponse:
        """Generate a structured response from pipeline data.

        Parameters
        ----------
        retrieval_result : dict or None
            Result from GraphRAG retrieval. Expected keys:
            'answer' (str), 'paths' (list), 'nodes' (list), 'confidence' (float).
        prompt_result : dict or None
            Result from prompt-based generation. Expected keys:
            'answer' (str), 'confidence' (float), 'sources' (list).
        mode : str
            One of 'graph', 'prompt', 'hybrid'.

        Returns
        -------
        GeneratedResponse
        """
        t0 = time.monotonic()

        if mode not in ("graph", "prompt", "hybrid"):
            raise ValueError(f"Invalid mode {mode!r}; must be graph/prompt/hybrid")

        citations = self._extract_citations(retrieval_result, prompt_result)
        answer = ""
        confidence = 0.0
        metadata: Dict[str, Any] = {"mode": mode}

        if mode == "graph":
            answer, confidence = self._generate_graph(retrieval_result)
        elif mode == "prompt":
            answer, confidence = self._generate_prompt(prompt_result)
        elif mode == "hybrid":
            graph_answer = self._get_answer_text(retrieval_result)
            prompt_answer = self._get_answer_text(prompt_result)
            graph_conf = self._get_confidence(retrieval_result)
            prompt_conf = self._get_confidence(prompt_result)
            answer = self.merge_results(graph_answer, prompt_answer,
                                        strategy="graph_priority")
            confidence = self.assess_confidence(retrieval_result, prompt_result)
            metadata["graph_confidence"] = graph_conf
            metadata["prompt_confidence"] = prompt_conf

        elapsed_ms = (time.monotonic() - t0) * 1000.0
        metadata["generation_time_ms"] = elapsed_ms

        return GeneratedResponse(
            answer=answer,
            confidence=confidence,
            citations=citations,
            mode=mode,
            metadata=metadata,
        )

    # ------------------------------------------------------------------
    # Citation formatting
    # ------------------------------------------------------------------

    def format_citation(self, source: Dict[str, Any]) -> str:
        """Format a citation from a source node dictionary.

        Parameters
        ----------
        source : dict
            Source node data. Expected keys: 'id', 'type', 'relevance',
            'excerpt', 'label', 'properties'.

        Returns
        -------
        str
            Formatted citation string.
        """
        source_id = source.get("id", "unknown")
        source_type = source.get("type", "unknown")
        relevance = source.get("relevance", 0.0)
        excerpt = source.get("excerpt", "")

        # Build a human-readable citation
        label = source.get("label", "")
        props = source.get("properties", {})

        parts: List[str] = []
        if label:
            parts.append(f"[{label}]")
        if source_id:
            parts.append(f"id={source_id}")
        if source_type:
            parts.append(f"type={source_type}")
        if relevance:
            parts.append(f"relevance={relevance:.2f}")

        header = " ".join(parts)

        if excerpt:
            return f"{header}: \"{excerpt}\""
        elif props:
            # Use first two property values as excerpt
            prop_values = list(props.values())[:2]
            prop_str = ", ".join(str(v) for v in prop_values)
            return f"{header}: \"{prop_str}\""
        else:
            return header

    # ------------------------------------------------------------------
    # Merge strategies
    # ------------------------------------------------------------------

    def merge_results(
        self,
        graph_answer: str,
        prompt_answer: str,
        strategy: str = "graph_priority",
    ) -> str:
        """Merge graph and prompt answers using the specified strategy.

        Parameters
        ----------
        graph_answer : str
            Answer from graph retrieval.
        prompt_answer : str
            Answer from prompt generation.
        strategy : str
            One of 'graph_priority', 'prompt_priority', 'weighted',
            'contradiction_check'.

        Returns
        -------
        str
            Merged answer text.
        """
        valid_strategies = (
            "graph_priority", "prompt_priority", "weighted", "contradiction_check"
        )
        if strategy not in valid_strategies:
            raise ValueError(
                f"Invalid strategy {strategy!r}; "
                f"must be one of {valid_strategies}"
            )

        if strategy == "graph_priority":
            return self._merge_graph_priority(graph_answer, prompt_answer)
        elif strategy == "prompt_priority":
            return self._merge_prompt_priority(graph_answer, prompt_answer)
        elif strategy == "weighted":
            return self._merge_weighted(graph_answer, prompt_answer)
        elif strategy == "contradiction_check":
            return self._merge_contradiction_check(graph_answer, prompt_answer)

        # Should not reach here
        return graph_answer or prompt_answer

    # ------------------------------------------------------------------
    # Confidence assessment
    # ------------------------------------------------------------------

    def assess_confidence(
        self,
        retrieval_result: Optional[Dict[str, Any]] = None,
        prompt_result: Optional[Dict[str, Any]] = None,
    ) -> float:
        """Assess overall confidence from retrieval and prompt results.

        Combines confidence scores from both sources. When both are present,
        takes a weighted average. When only one is present, uses that score.
        When neither is present, returns 0.0.

        Parameters
        ----------
        retrieval_result : dict or None
            GraphRAG result with optional 'confidence' key.
        prompt_result : dict or None
            Prompt result with optional 'confidence' key.

        Returns
        -------
        float
            Combined confidence in [0.0, 1.0].
        """
        graph_conf = self._get_confidence(retrieval_result)
        prompt_conf = self._get_confidence(prompt_result)

        has_graph = retrieval_result is not None
        has_prompt = prompt_result is not None

        if has_graph and has_prompt:
            total_weight = self._graph_weight + self._prompt_weight
            if total_weight == 0.0:
                return 0.0
            return (graph_conf * self._graph_weight +
                    prompt_conf * self._prompt_weight) / total_weight
        elif has_graph:
            return graph_conf
        elif has_prompt:
            return prompt_conf
        else:
            return 0.0

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _generate_graph(
        self, retrieval_result: Optional[Dict[str, Any]]
    ) -> Tuple[str, float]:
        """Generate answer from graph retrieval result."""
        if retrieval_result is None:
            return "No graph data available for this query.", 0.0

        answer = self._get_answer_text(retrieval_result)
        confidence = self._get_confidence(retrieval_result)

        if not answer:
            # Try to synthesize from paths/nodes
            paths = retrieval_result.get("paths", [])
            nodes = retrieval_result.get("nodes", [])
            if paths:
                path_descs = []
                for p in paths[:5]:
                    if isinstance(p, dict):
                        path_descs.append(
                            p.get("description", json.dumps(p, default=str)[:100])
                        )
                    else:
                        path_descs.append(str(p)[:100])
                answer = f"Retrieved {len(paths)} graph paths. Top results: " + \
                         "; ".join(path_descs)
                confidence = min(0.7, confidence + 0.3) if confidence < 0.7 else confidence
            elif nodes:
                node_descs = [str(n)[:80] for n in nodes[:5]]
                answer = f"Found {len(nodes)} relevant nodes: " + \
                         "; ".join(node_descs)
                confidence = min(0.5, confidence + 0.2) if confidence < 0.5 else confidence
            else:
                answer = "Graph retrieval found no results for this query."
                confidence = 0.0

        return answer, confidence

    def _generate_prompt(
        self, prompt_result: Optional[Dict[str, Any]]
    ) -> Tuple[str, float]:
        """Generate answer from prompt result."""
        if prompt_result is None:
            return "No prompt-based result available for this query.", 0.0

        answer = self._get_answer_text(prompt_result)
        confidence = self._get_confidence(prompt_result)

        if not answer:
            answer = "Prompt generation produced no answer."
            confidence = 0.0

        return answer, confidence

    def _extract_citations(
        self,
        retrieval_result: Optional[Dict[str, Any]],
        prompt_result: Optional[Dict[str, Any]],
    ) -> List[Citation]:
        """Extract citations from retrieval and prompt results."""
        citations: List[Citation] = []

        if retrieval_result is not None:
            # Extract from 'nodes' if present
            for node in retrieval_result.get("nodes", []):
                if isinstance(node, dict):
                    citations.append(Citation(
                        source_id=node.get("id", str(uuid.uuid4())),
                        source_type=node.get("type", "graph_node"),
                        relevance=min(1.0, max(0.0, node.get("relevance", 0.5))),
                        excerpt=node.get("excerpt", node.get("label", "")),
                    ))
            # Extract from 'paths' if present
            for path in retrieval_result.get("paths", []):
                if isinstance(path, dict):
                    citations.append(Citation(
                        source_id=path.get("id", str(uuid.uuid4())),
                        source_type="graph_path",
                        relevance=min(1.0, max(0.0, path.get("relevance", 0.4))),
                        excerpt=path.get("description", "")[:200],
                    ))

        if prompt_result is not None:
            for source in prompt_result.get("sources", []):
                if isinstance(source, dict):
                    citations.append(Citation(
                        source_id=source.get("id", str(uuid.uuid4())),
                        source_type=source.get("type", "document"),
                        relevance=min(1.0, max(0.0, source.get("relevance", 0.5))),
                        excerpt=source.get("excerpt", ""),
                    ))

        # Sort by relevance descending
        citations.sort(key=lambda c: c.relevance, reverse=True)
        return citations

    @staticmethod
    def _get_answer_text(result: Optional[Dict[str, Any]]) -> str:
        """Extract answer text from a result dict."""
        if result is None:
            return ""
        return str(result.get("answer", ""))

    @staticmethod
    def _get_confidence(result: Optional[Dict[str, Any]]) -> float:
        """Extract and clamp confidence from a result dict."""
        if result is None:
            return 0.0
        conf = result.get("confidence", 0.0)
        try:
            conf = float(conf)
        except (TypeError, ValueError):
            conf = 0.0
        return max(0.0, min(1.0, conf))

    # -- Merge strategy implementations ------------------------------------

    def _merge_graph_priority(self, graph_answer: str, prompt_answer: str) -> str:
        """Use graph answer if available, fall back to prompt."""
        if graph_answer and graph_answer.strip():
            if prompt_answer and prompt_answer.strip():
                return f"{graph_answer}\n\n[Additional context: {prompt_answer}]"
            return graph_answer
        return prompt_answer or "No answer available."

    def _merge_prompt_priority(self, graph_answer: str, prompt_answer: str) -> str:
        """Use prompt answer, augment with graph context."""
        if prompt_answer and prompt_answer.strip():
            if graph_answer and graph_answer.strip():
                return f"{prompt_answer}\n\n[Graph context: {graph_answer}]"
            return prompt_answer
        return graph_answer or "No answer available."

    def _merge_weighted(self, graph_answer: str, prompt_answer: str) -> str:
        """Combine answers with configurable weights.

        If both are present, presents them with their weight indicators.
        If only one is present, uses it directly.
        """
        has_graph = bool(graph_answer and graph_answer.strip())
        has_prompt = bool(prompt_answer and prompt_answer.strip())

        if has_graph and has_prompt:
            parts: List[str] = []
            if self._graph_weight >= self._prompt_weight:
                parts.append(f"[Primary (weight={self._graph_weight:.1f})]: {graph_answer}")
                parts.append(f"[Supplementary (weight={self._prompt_weight:.1f})]: {prompt_answer}")
            else:
                parts.append(f"[Primary (weight={self._prompt_weight:.1f})]: {prompt_answer}")
                parts.append(f"[Supplementary (weight={self._graph_weight:.1f})]: {graph_answer}")
            return "\n\n".join(parts)
        elif has_graph:
            return graph_answer
        elif has_prompt:
            return prompt_answer
        else:
            return "No answer available."

    def _merge_contradiction_check(
        self, graph_answer: str, prompt_answer: str
    ) -> str:
        """Flag contradictions between graph and prompt answers."""
        has_graph = bool(graph_answer and graph_answer.strip())
        has_prompt = bool(prompt_answer and prompt_answer.strip())

        if not has_graph and not has_prompt:
            return "No answer available."
        if not has_graph:
            return prompt_answer
        if not has_prompt:
            return graph_answer

        contradictions = _detect_contradictions(graph_answer, prompt_answer)

        if contradictions:
            # Report contradictions
            parts = [
                f"[GRAPH ANSWER]: {graph_answer}",
                f"[PROMPT ANSWER]: {prompt_answer}",
                "",
                f"⚠ CONTRADICTION DETECTED ({len(contradictions)} conflict(s)):",
            ]
            for i, c in enumerate(contradictions, 1):
                parts.append(
                    f"  {i}. Overlap={c['overlap']:.2f}: "
                    f"\"{c['graph_sentence'][:80]}...\" vs "
                    f"\"{c['prompt_sentence'][:80]}...\""
                )
            return "\n".join(parts)
        else:
            # No contradictions — combine
            return f"{graph_answer}\n\n[Confirmed by prompt analysis: {prompt_answer}]"

    def __repr__(self) -> str:
        return (
            f"ResponseGenerator(graph_weight={self._graph_weight}, "
            f"prompt_weight={self._prompt_weight})"
        )
