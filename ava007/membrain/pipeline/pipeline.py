"""
pipeline.py — Core Pipeline for QAG-MemBrain (Layer 7).

The main pipeline that wires all MemBrain layers together into an end-to-end
query processing flow:

    1. Route query via DualBrainRouter → GRAPH / PROMPT / HYBRID
    2. If GRAPH:  execute GraphRAG retrieval
    3. If PROMPT: generate via response generator
    4. If HYBRID: do both, merge results
    5. Writeback result to ion store
    6. Store in fast_mesh for caching
    7. Return PipelineResult

All sub-components accept dependency injection for testability; if not
provided, dict-based in-memory mocks are used.
"""

from __future__ import annotations

import hashlib
import json
import threading
import time
import uuid
from collections import Counter
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from .response_generator import ResponseGenerator, GeneratedResponse
from .writeback import MemoryWriteback, WritebackRecord, compute_result_hash


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class PipelineResult:
    """Result of a single pipeline execution.

    Attributes:
        query:       Original query string.
        answer:      Generated answer text.
        mode:        Routing mode ('graph', 'prompt', 'hybrid').
        confidence:  Overall confidence score in [0.0, 1.0].
        latency_ms:  Total pipeline latency in milliseconds.
        layers_used: List of layer names that contributed.
        metadata:    Additional metadata.
    """
    query: str
    answer: str
    mode: str
    confidence: float
    latency_ms: float
    layers_used: List[str] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "query": self.query,
            "answer": self.answer,
            "mode": self.mode,
            "confidence": self.confidence,
            "latency_ms": self.latency_ms,
            "layers_used": self.layers_used,
            "metadata": self.metadata,
        }


@dataclass
class PipelineStats:
    """Aggregate statistics over pipeline executions.

    Attributes:
        total_queries:     Number of queries processed.
        avg_latency_ms:    Average latency in milliseconds.
        mode_distribution: Dict mapping mode → count.
        cache_hit_rate:    Fraction of queries served from cache.
    """
    total_queries: int = 0
    avg_latency_ms: float = 0.0
    mode_distribution: Dict[str, int] = field(default_factory=dict)
    cache_hit_rate: float = 0.0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "total_queries": self.total_queries,
            "avg_latency_ms": self.avg_latency_ms,
            "mode_distribution": self.mode_distribution,
            "cache_hit_rate": self.cache_hit_rate,
        }


# ---------------------------------------------------------------------------
# Mock DualBrainRouter
# ---------------------------------------------------------------------------

class _MockDualBrainRouter:
    """Simplified mock DualBrainRouter for when the real L6 module is absent.

    Routes queries based on heuristic keyword detection:

    - Queries containing factual keywords (what, who, when, where, how many)
      → 'graph' mode
    - Queries containing creative keywords (imagine, create, write, suggest)
      → 'prompt' mode
    - All others → 'hybrid' mode
    """

    GRAPH_KEYWORDS = {"what", "who", "when", "where", "how many", "which",
                      "define", "explain", "fact", "is", "are", "was", "were"}
    PROMPT_KEYWORDS = {"imagine", "create", "write", "suggest", "invent",
                       "brainstorm", "compose", "design", "generate", "dream"}

    def route(self, query: str, context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Route a query to a processing mode.

        Returns
        -------
        dict
            {'mode': 'graph'|'prompt'|'hybrid', 'confidence': float}
        """
        query_lower = query.lower()
        query_words = set(query_lower.split())

        graph_hit = bool(query_words & self.GRAPH_KEYWORDS) or \
                    any(kw in query_lower for kw in self.GRAPH_KEYWORDS if " " in kw)
        prompt_hit = bool(query_words & self.PROMPT_KEYWORDS) or \
                     any(kw in query_lower for kw in self.PROMPT_KEYWORDS if " " in kw)

        if graph_hit and not prompt_hit:
            return {"mode": "graph", "confidence": 0.85}
        elif prompt_hit and not graph_hit:
            return {"mode": "prompt", "confidence": 0.75}
        elif graph_hit and prompt_hit:
            return {"mode": "hybrid", "confidence": 0.8}
        else:
            return {"mode": "hybrid", "confidence": 0.6}


# ---------------------------------------------------------------------------
# Mock GraphRAG retrieval
# ---------------------------------------------------------------------------

class _MockGraphRAG:
    """Simple mock GraphRAG retrieval engine."""

    def query(self, query: str, context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Mock retrieval that returns a synthesized result.

        Returns a dict with 'answer', 'confidence', 'nodes', 'paths'.
        """
        # Produce a deterministic but query-specific mock answer
        query_hash = hashlib.sha256(query.encode()).hexdigest()[:8]
        answer = f"[GraphRAG] Retrieved results for query '{query}' (ref:{query_hash})"
        confidence = 0.72

        return {
            "answer": answer,
            "confidence": confidence,
            "nodes": [
                {"id": f"node_{query_hash}_1", "type": "concept",
                 "relevance": 0.9, "excerpt": f"Concept related to '{query}'"},
                {"id": f"node_{query_hash}_2", "type": "entity",
                 "relevance": 0.7, "excerpt": f"Entity associated with '{query}'"},
            ],
            "paths": [
                {"id": f"path_{query_hash}_1", "relevance": 0.85,
                 "description": f"Path connecting concepts about '{query}'"},
            ],
        }


# ---------------------------------------------------------------------------
# Mock ion store (dict-based)
# ---------------------------------------------------------------------------

class _MockIonStore:
    """Thread-safe dict-based mock ion memory store."""

    def __init__(self) -> None:
        self._data: Dict[str, Any] = {}
        self._lock = threading.Lock()

    def put(self, key: str, value: Any) -> None:
        with self._lock:
            self._data[key] = value

    def get(self, key: str) -> Optional[Any]:
        with self._lock:
            return self._data.get(key)

    def has(self, key: str) -> bool:
        with self._lock:
            return key in self._data

    def delete(self, key: str) -> bool:
        with self._lock:
            if key in self._data:
                del self._data[key]
                return True
            return False


# ---------------------------------------------------------------------------
# Mock FAStMesh (in-memory)
# ---------------------------------------------------------------------------

class _MockMesh:
    """In-memory mock FAStMesh coordinator."""

    def __init__(self) -> None:
        self._cache: Dict[str, bytes] = {}
        self._lock = threading.Lock()

    def store(self, data: bytes, content_type: str = "application/octet-stream") -> str:
        """Store data and return its content hash."""
        content_hash = hashlib.sha256(data).hexdigest()
        with self._lock:
            self._cache[content_hash] = data
        return content_hash

    def retrieve(self, content_hash: str) -> Optional[bytes]:
        """Retrieve data by content hash."""
        with self._lock:
            return self._cache.get(content_hash)

    def exists(self, content_hash: str) -> bool:
        with self._lock:
            return content_hash in self._cache


# ---------------------------------------------------------------------------
# MembrainPipeline
# ---------------------------------------------------------------------------

class MembrainPipeline:
    """Main pipeline that wires all MemBrain layers together.

    Parameters
    ----------
    store : Any or None
        Ion memory store instance. Must support ``put(key, value)`` and
        ``get(key)``. If None, a dict-based mock is created.
    mesh : Any or None
        FAStMesh coordinator. Must support ``store(data, content_type)``
        and ``retrieve(content_hash)``. If None, an in-memory mock is used.
    retrieval : Any or None
        GraphRAG retrieval engine. Must support ``query(query, context)``.
        If None, a simple mock is used.
    router : Any or None
        DualBrainRouter. Must support ``route(query, context)`` returning
        ``{'mode': str, 'confidence': float}``. If None, a heuristic
        mock is used.
    response_generator : ResponseGenerator or None
        Custom ResponseGenerator. If None, a default is created.
    writeback : MemoryWriteback or None
        Custom MemoryWriteback. If None, a default is created.
    """

    def __init__(
        self,
        store: Optional[Any] = None,
        mesh: Optional[Any] = None,
        retrieval: Optional[Any] = None,
        router: Optional[Any] = None,
        response_generator: Optional[ResponseGenerator] = None,
        writeback: Optional[MemoryWriteback] = None,
    ) -> None:
        self._store = store if store is not None else _MockIonStore()
        self._mesh = mesh if mesh is not None else _MockMesh()
        self._retrieval = retrieval if retrieval is not None else _MockGraphRAG()
        self._router = router if router is not None else _MockDualBrainRouter()
        self._generator = response_generator if response_generator is not None else ResponseGenerator()
        self._writeback = writeback if writeback is not None else MemoryWriteback(
            default_store=self._store
        )

        # Execution statistics
        self._total_queries = 0
        self._total_latency_ms = 0.0
        self._mode_counts: Counter = Counter()
        self._cache_hits = 0
        self._stats_lock = threading.Lock()

        # Cache mapping: query_hash → content_hash in mesh
        self._cache_map: Dict[str, str] = {}

    # ------------------------------------------------------------------
    # Core execution
    # ------------------------------------------------------------------

    def execute(
        self,
        query: str,
        context: Optional[Dict[str, Any]] = None,
    ) -> PipelineResult:
        """Execute a single query through the full pipeline.

        Flow:
            1. Check cache for previous result (fast_mesh)
            2. Route query via DualBrainRouter
            3. If GRAPH:  execute GraphRAG retrieval
            4. If PROMPT: generate via response generator
            5. If HYBRID: do both, merge results
            6. Generate final response
            7. Writeback result to ion store
            8. Store in fast_mesh for caching
            9. Return PipelineResult

        Parameters
        ----------
        query : str
            The query string.
        context : dict or None
            Optional context metadata.

        Returns
        -------
        PipelineResult
        """
        t0 = time.monotonic()
        ctx = context or {}
        layers_used: List[str] = ["pipeline"]

        # 1. Check cache
        query_hash = hashlib.sha256(query.encode()).hexdigest()
        content_hash = self._cache_map.get(query_hash)
        cached = self._mesh.retrieve(content_hash) if content_hash else None
        if cached is not None:
            try:
                cached_data = json.loads(cached.decode("utf-8"))
                latency_ms = (time.monotonic() - t0) * 1000.0
                with self._stats_lock:
                    self._total_queries += 1
                    self._total_latency_ms += latency_ms
                    self._cache_hits += 1
                    mode = cached_data.get("mode", "unknown")
                    self._mode_counts[mode] += 1

                return PipelineResult(
                    query=query,
                    answer=cached_data.get("answer", ""),
                    mode=mode,
                    confidence=cached_data.get("confidence", 0.0),
                    latency_ms=latency_ms,
                    layers_used=["pipeline", "mesh_cache"],
                    metadata={"cache_hit": True, **cached_data.get("metadata", {})},
                )
            except (json.JSONDecodeError, UnicodeDecodeError):
                pass  # Fall through to full execution

        # 2. Route query
        routing = self._router.route(query, ctx)
        mode = routing.get("mode", "hybrid")
        routing_confidence = routing.get("confidence", 0.5)
        layers_used.append("dualbrain")

        retrieval_result: Optional[Dict[str, Any]] = None
        prompt_result: Optional[Dict[str, Any]] = None

        # 3/4/5. Execute based on mode
        if mode == "graph":
            retrieval_result = self._execute_graph(query, ctx)
            layers_used.append("graphrag")
        elif mode == "prompt":
            prompt_result = self._execute_prompt(query, ctx)
            layers_used.append("mellum2")
        elif mode == "hybrid":
            retrieval_result = self._execute_graph(query, ctx)
            prompt_result = self._execute_prompt(query, ctx)
            layers_used.extend(["graphrag", "mellum2"])

        # 6. Generate final response
        generated = self._generator.generate(
            retrieval_result=retrieval_result,
            prompt_result=prompt_result,
            mode=mode,
        )
        layers_used.append("response_generator")

        # Compute final confidence
        confidence = generated.confidence
        if confidence == 0.0:
            confidence = routing_confidence

        # 7. Writeback to ion store
        result_data = {
            "query": query,
            "answer": generated.answer,
            "mode": mode,
            "confidence": confidence,
            "citations": [c.to_dict() for c in generated.citations],
            "metadata": generated.metadata,
        }
        writeback_record = self._writeback.writeback(result_data)
        layers_used.append("ion_memory")

        # 8. Store in fast_mesh for caching
        try:
            cache_data = json.dumps(result_data, default=str).encode("utf-8")
            content_hash = self._mesh.store(cache_data, content_type="application/json")
            self._cache_map[query_hash] = content_hash
            layers_used.append("fast_mesh")
        except Exception:
            pass  # Non-fatal if caching fails

        latency_ms = (time.monotonic() - t0) * 1000.0

        # 9. Update stats
        with self._stats_lock:
            self._total_queries += 1
            self._total_latency_ms += latency_ms
            self._mode_counts[mode] += 1

        metadata = {
            "cache_hit": False,
            "routing": routing,
            "writeback_id": writeback_record.id,
            "writeback_tier": writeback_record.tier,
            "writeback_hash": writeback_record.result_hash,
            "generation_time_ms": generated.metadata.get("generation_time_ms", 0.0),
        }
        if retrieval_result is not None:
            metadata["retrieval_confidence"] = retrieval_result.get("confidence", 0.0)
        if prompt_result is not None:
            metadata["prompt_confidence"] = prompt_result.get("confidence", 0.0)

        return PipelineResult(
            query=query,
            answer=generated.answer,
            mode=mode,
            confidence=confidence,
            latency_ms=latency_ms,
            layers_used=layers_used,
            metadata=metadata,
        )

    def execute_batch(
        self,
        queries: List[str],
        context: Optional[Dict[str, Any]] = None,
    ) -> List[PipelineResult]:
        """Execute multiple queries through the pipeline sequentially.

        Parameters
        ----------
        queries : list of str
            Query strings to process.
        context : dict or None
            Optional shared context for all queries.

        Returns
        -------
        list of PipelineResult
        """
        results: List[PipelineResult] = []
        for query in queries:
            results.append(self.execute(query, context))
        return results

    # ------------------------------------------------------------------
    # Statistics
    # ------------------------------------------------------------------

    def get_stats(self) -> PipelineStats:
        """Return aggregate pipeline statistics.

        Returns
        -------
        PipelineStats
        """
        with self._stats_lock:
            avg_latency = (
                self._total_latency_ms / self._total_queries
                if self._total_queries > 0 else 0.0
            )
            cache_hit_rate = (
                self._cache_hits / self._total_queries
                if self._total_queries > 0 else 0.0
            )
            return PipelineStats(
                total_queries=self._total_queries,
                avg_latency_ms=avg_latency,
                mode_distribution=dict(self._mode_counts),
                cache_hit_rate=cache_hit_rate,
            )

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------

    @property
    def store(self) -> Any:
        """Access the ion memory store."""
        return self._store

    @property
    def mesh(self) -> Any:
        """Access the FAStMesh coordinator."""
        return self._mesh

    @property
    def retrieval(self) -> Any:
        """Access the GraphRAG retrieval engine."""
        return self._retrieval

    @property
    def router(self) -> Any:
        """Access the DualBrainRouter."""
        return self._router

    @property
    def generator(self) -> ResponseGenerator:
        """Access the ResponseGenerator."""
        return self._generator

    @property
    def writeback_engine(self) -> MemoryWriteback:
        """Access the MemoryWriteback engine."""
        return self._writeback

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _execute_graph(
        self, query: str, context: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Execute graph-based retrieval."""
        if hasattr(self._retrieval, "query"):
            result = self._retrieval.query(query, context)
            if isinstance(result, dict):
                return result
            # Handle object results with attributes
            result_dict: Dict[str, Any] = {"query": query}
            for attr in ("answer", "confidence", "nodes", "paths", "total_count"):
                if hasattr(result, attr):
                    result_dict[attr] = getattr(result, attr)
            if "confidence" not in result_dict:
                result_dict["confidence"] = 0.5
            if "answer" not in result_dict:
                result_dict["answer"] = str(result)[:200]
            return result_dict
        else:
            return {
                "query": query,
                "answer": "GraphRAG retrieval unavailable.",
                "confidence": 0.0,
            }

    def _execute_prompt(
        self, query: str, context: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Execute prompt-based generation.

        Since there is no actual LLM available in the stdlib, this
        produces a template-based mock answer with query-specific content.
        """
        # Template-based mock answer generation
        query_hash = hashlib.sha256(query.encode()).hexdigest()[:8]
        answer = (
            f"Based on analysis of the query '{query}', here is a synthesized "
            f"response. The key aspects involve processing the query context "
            f"and generating a relevant output. [ref:{query_hash}]"
        )
        confidence = 0.65

        return {
            "query": query,
            "answer": answer,
            "confidence": confidence,
            "sources": [
                {"id": f"src_{query_hash}_1", "type": "knowledge_base",
                 "relevance": 0.8, "excerpt": f"Knowledge related to '{query}'"},
            ],
        }

    def __repr__(self) -> str:
        stats = self.get_stats()
        return (
            f"MembrainPipeline(queries={stats.total_queries}, "
            f"avg_latency={stats.avg_latency_ms:.1f}ms, "
            f"modes={stats.mode_distribution})"
        )
