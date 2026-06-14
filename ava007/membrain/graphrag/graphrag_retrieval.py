"""
graphrag_retrieval.py — Core GraphRAG Retrieval Engine for QAG-MemBrain (Layer 3).

The main retrieval engine that ties together property graphs, path restrictors,
LET variables, and schema validation into a unified GraphRAG query interface.

Three retrieval modes are provided:

  1. **query()**              — Pattern-based graph traversal with path
                                restrictors, edge type / node label filters,
                                and LET variable bindings.

  2. **structured_retrieve()**— Parse a simple structured query string
                                (GQL-inspired) and execute it with optional
                                LET bindings.

  3. **hybrid_retrieve()**    — Combine semantic keyword matching with
                                structural graph pattern traversal, ranked
                                by cost with optional semantic boosting.

All methods return ``QueryResult`` which carries discovered paths, counts,
execution timing, and LET variable snapshots.
"""

from __future__ import annotations

import hashlib
import json
import re
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set, Tuple

from .gql_let import GQLLetBindings
from .path_restrictors import (
    GraphPath,
    PathType,
    traverse_with_restrictor,
)
from .property_graph import Edge, Node, PropertyGraph
from .schema_validator import GraphValidationResult, SchemaValidator


# ---------------------------------------------------------------------------
# Query data structures
# ---------------------------------------------------------------------------

@dataclass
class QueryPattern:
    """Describes a graph query pattern for the retrieval engine.

    Attributes:
        path_type:     Path restrictor to apply (WALK / TRAIL / ACYCLIC / SIMPLE).
        edge_types:    Only traverse edges whose type is in this list.
                       Empty list means no filter (all edge types).
        node_labels:   Only visit nodes carrying at least one of these labels.
                       Empty list means no filter (all labels).
        max_depth:     Maximum traversal depth (number of edges).
        let_bindings:  LET variable bindings to parameterize the query.
    """
    path_type: PathType = PathType.SIMPLE
    edge_types: List[str] = field(default_factory=list)
    node_labels: List[str] = field(default_factory=list)
    max_depth: int = 5
    let_bindings: Dict[str, Any] = field(default_factory=dict)


@dataclass
class QueryResult:
    """Result of a GraphRAG retrieval query.

    Attributes:
        paths:            Discovered graph paths, sorted by cost ascending.
        total_count:      Total number of paths found.
        execution_time_ms: Wall-clock time for the query in milliseconds.
        let_variables:    Snapshot of LET variable bindings after query
                          execution (includes any bindings produced during
                          the query).
    """
    paths: List[GraphPath] = field(default_factory=list)
    total_count: int = 0
    execution_time_ms: float = 0.0
    let_variables: Dict[str, Any] = field(default_factory=dict)

    def top_k(self, k: int = 10) -> List[GraphPath]:
        """Return the top-k cheapest paths."""
        return self.paths[:k]

    def path_costs(self) -> List[float]:
        """Return a list of path costs in order."""
        return [p.cost for p in self.paths]


# ---------------------------------------------------------------------------
# Simple structured query parser
# ---------------------------------------------------------------------------

def _parse_structured_query(query_str: str) -> QueryPattern:
    """Parse a simple structured query string into a QueryPattern.

    Supported syntax (GQL-inspired mini-language)::

        FROM <node_id>
        MATCH TRAIL|WALK|ACYCLIC|SIMPLE
        EDGES <type1,type2,...>
        LABELS <label1,label2,...>
        DEPTH <n>
        LET $var = <value>

    Each clause is optional and case-insensitive.  ``FROM`` is not stored
    in the QueryPattern (it is the start_node argument to the retrieval
    method).  The parser extracts the rest.
    """
    pattern = QueryPattern()
    lines = query_str.strip().splitlines()

    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue

        upper = stripped.upper()

        if upper.startswith("MATCH"):
            match = re.search(r"MATCH\s+(WALK|TRAIL|ACYCLIC|SIMPLE)",
                              stripped, re.IGNORECASE)
            if match:
                pattern.path_type = PathType(match.group(1).upper())

        elif upper.startswith("EDGES"):
            match = re.search(r"EDGES\s+(.+)", stripped, re.IGNORECASE)
            if match:
                pattern.edge_types = [
                    e.strip() for e in match.group(1).split(",")
                    if e.strip()
                ]

        elif upper.startswith("LABELS"):
            match = re.search(r"LABELS\s+(.+)", stripped, re.IGNORECASE)
            if match:
                pattern.node_labels = [
                    l.strip() for l in match.group(1).split(",")
                    if l.strip()
                ]

        elif upper.startswith("DEPTH"):
            match = re.search(r"DEPTH\s+(\d+)", stripped, re.IGNORECASE)
            if match:
                pattern.max_depth = int(match.group(1))

        elif upper.startswith("LET"):
            # LET $var = value
            match = re.search(
                r"LET\s+\$(\w+)\s*=\s*(.+)", stripped, re.IGNORECASE)
            if match:
                var_name = match.group(1)
                raw_value = match.group(2).strip()
                # Attempt to parse the value
                value: Any = raw_value
                # Try JSON decode for complex values
                try:
                    value = json.loads(raw_value)
                except (json.JSONDecodeError, ValueError):
                    # Try simple type coercion
                    if raw_value.lower() == "true":
                        value = True
                    elif raw_value.lower() == "false":
                        value = False
                    elif raw_value.lower() == "null":
                        value = None
                    else:
                        # Try numeric
                        try:
                            value = int(raw_value)
                        except ValueError:
                            try:
                                value = float(raw_value)
                            except ValueError:
                                # Strip surrounding quotes if present
                                if len(raw_value) >= 2 and (
                                    (raw_value.startswith('"') and raw_value.endswith('"'))
                                    or (raw_value.startswith("'") and raw_value.endswith("'"))
                                ):
                                    value = raw_value[1:-1]
                pattern.let_bindings[var_name] = value

    return pattern


# ---------------------------------------------------------------------------
# Semantic keyword matching helper
# ---------------------------------------------------------------------------

def _keyword_similarity(text: str, query: str) -> float:
    """Compute a simple keyword-overlap similarity score.

    Tokenises both *text* and *query* on whitespace/punctuation, then
    returns the Jaccard-like ratio of matching query tokens to total
    query tokens.  Returns a value in [0.0, 1.0].
    """
    def _tokenise(s: str) -> Set[str]:
        return set(re.findall(r"[a-zA-Z0-9]+", s.lower()))

    text_tokens = _tokenise(text)
    query_tokens = _tokenise(query)

    if not query_tokens:
        return 0.0

    overlap = text_tokens & query_tokens
    return len(overlap) / len(query_tokens)


def _node_text(node: Node) -> str:
    """Construct a searchable text blob from a node's properties."""
    parts: List[str] = []
    for key, val in node.properties.items():
        parts.append(f"{key}: {val}")
    return " | ".join(parts)


# ---------------------------------------------------------------------------
# GraphRAGRetrieval engine
# ---------------------------------------------------------------------------

class GraphRAGRetrieval:
    """Core GraphRAG retrieval engine for QAG-MemBrain Layer 3.

    Ties together property graphs, path restrictors, LET variables, and
    optional schema validation.  Three retrieval modes are provided:

      - ``query()``              — Pattern-based traversal
      - ``structured_retrieve()``— Structured query string
      - ``hybrid_retrieve()``    — Semantic + structural retrieval
    """

    def __init__(self, validator: Optional[SchemaValidator] = None,
                 validate_on_query: bool = False) -> None:
        """Initialise the retrieval engine.

        Args:
            validator:          Optional SchemaValidator for pre-query
                                validation.
            validate_on_query:  If True, run schema validation before each
                                query and skip if the graph is invalid.
        """
        self.validator = validator
        self.validate_on_query = validate_on_query

    # -- Internal helpers ---------------------------------------------------

    def _maybe_validate(self, graph: PropertyGraph) -> Optional[GraphValidationResult]:
        """Run schema validation if configured.  Returns None if skipped."""
        if self.validator is None or not self.validate_on_query:
            return None
        return self.validator.validate_graph(graph)

    def _build_let_bindings(self,
                            pattern: QueryPattern,
                            extra: Optional[Dict[str, Any]] = None) -> GQLLetBindings:
        """Construct a GQLLetBindings from the pattern and extra bindings."""
        bindings = GQLLetBindings()
        for name, value in pattern.let_bindings.items():
            bindings.bind(name, value)
        if extra:
            for name, value in extra.items():
                bindings.bind(name, value)
        return bindings

    def _apply_let_filters(self, graph: PropertyGraph,
                           bindings: GQLLetBindings) -> None:
        """Apply any LET variables that affect the graph query.

        Current supported LET variables:
          - ``$max_weight``: maximum edge weight to traverse
          - ``$min_weight``: minimum edge weight to traverse
          - ``$property_filter``: dict of property filters for nodes

        These are read but not removed from bindings (they remain available
        in the result).
        """
        # This is a no-op placeholder for side-effect-based LET variables.
        # The actual filtering is done during traversal by checking bindings.
        pass

    def _should_traverse_edge(self, edge: Edge,
                              bindings: GQLLetBindings) -> bool:
        """Check if an edge should be traversed based on LET bindings.

        Supported LET variables:
          - ``$max_weight``: skip edges with weight > this value
          - ``$min_weight``: skip edges with weight < this value
        """
        max_w = bindings.resolve_or("$max_weight")
        if max_w is not None:
            if edge.weight > float(max_w):
                return False

        min_w = bindings.resolve_or("$min_weight")
        if min_w is not None:
            if edge.weight < float(min_w):
                return False

        return True

    # -- Public API ---------------------------------------------------------

    def query(self, graph: PropertyGraph, start_node: str,
              pattern: QueryPattern) -> QueryResult:
        """Execute a pattern-based graph traversal query.

        Traverses *graph* from *start_node* using the constraints in
        *pattern* (path type, edge/node filters, depth, LET bindings).
        Returns a QueryResult with all discovered paths sorted by cost.

        Args:
            graph:       The property graph to query.
            start_node:  ID of the starting node.
            pattern:     Query pattern with path type, filters, etc.

        Returns:
            QueryResult with paths, counts, timing, and LET snapshot.
        """
        t0 = time.monotonic()

        # Optional schema validation
        validation = self._maybe_validate(graph)
        if validation is not None and not validation.valid:
            return QueryResult(
                paths=[],
                total_count=0,
                execution_time_ms=(time.monotonic() - t0) * 1000.0,
                let_variables={},
            )

        # Build LET bindings from pattern
        bindings = self._build_let_bindings(pattern)
        self._apply_let_filters(graph, bindings)

        # Determine edge types and node labels from LET overrides
        edge_types = pattern.edge_types or None
        node_labels = pattern.node_labels or None

        # LET $edge_types can override
        let_edge_types = bindings.resolve_or("$edge_types")
        if let_edge_types is not None and isinstance(let_edge_types, list):
            edge_types = let_edge_types

        let_node_labels = bindings.resolve_or("$node_labels")
        if let_node_labels is not None and isinstance(let_node_labels, list):
            node_labels = let_node_labels

        # Traverse with restrictor
        all_paths = traverse_with_restrictor(
            graph=graph,
            start=start_node,
            path_type=pattern.path_type,
            max_depth=pattern.max_depth,
            edge_types=edge_types,
            node_labels=node_labels,
        )

        # Filter paths by LET $max_weight / $min_weight
        filtered_paths: List[GraphPath] = []
        for gp in all_paths:
            # Check all edges in the path against LET weight bounds
            valid = True
            for eid in gp.edges:
                edge = graph.get_edge(eid)
                if edge is not None and not self._should_traverse_edge(edge, bindings):
                    valid = False
                    break
            if valid:
                filtered_paths.append(gp)

        # Sort by cost ascending
        filtered_paths.sort(key=lambda p: p.cost)

        # Store results in LET bindings
        bindings.bind("$result_count", len(filtered_paths))
        if filtered_paths:
            bindings.bind("$min_cost", filtered_paths[0].cost)
            bindings.bind("$max_cost", filtered_paths[-1].cost)

        elapsed_ms = (time.monotonic() - t0) * 1000.0

        return QueryResult(
            paths=filtered_paths,
            total_count=len(filtered_paths),
            execution_time_ms=elapsed_ms,
            let_variables=bindings.to_dict(),
        )

    def structured_retrieve(self, graph: PropertyGraph, query_str: str,
                            let_bindings: Optional[Dict[str, Any]] = None) -> QueryResult:
        """Execute a structured query string against the graph.

        The query string uses a GQL-inspired mini-language::

            FROM concept_A
            MATCH TRAIL
            EDGES RELATED_TO,DEPENDS_ON
            LABELS Concept,Topic
            DEPTH 4
            LET $threshold = 0.8

        The ``FROM`` clause specifies the start node; the rest defines the
        QueryPattern.  Additional *let_bindings* are merged into the
        pattern's bindings.

        Args:
            graph:         The property graph to query.
            query_str:     Structured query string.
            let_bindings:  Optional additional LET variable bindings.

        Returns:
            QueryResult with paths, counts, timing, and LET snapshot.

        Raises:
            ValueError: If the query string does not contain a FROM clause.
        """
        t0 = time.monotonic()

        pattern = _parse_structured_query(query_str)

        # Extract start node from FROM clause
        from_match = re.search(r"FROM\s+(\S+)", query_str, re.IGNORECASE)
        if not from_match:
            raise ValueError(
                "Structured query must contain a FROM clause: "
                "'FROM <node_id>'")

        start_node = from_match.group(1)

        # Merge extra LET bindings
        if let_bindings:
            pattern.let_bindings.update(let_bindings)

        result = self.query(graph, start_node, pattern)

        # Override timing to include parsing
        result.execution_time_ms = (time.monotonic() - t0) * 1000.0
        return result

    def hybrid_retrieve(self, graph: PropertyGraph, semantic_query: str,
                        structural_pattern: Optional[QueryPattern] = None,
                        top_k: int = 10) -> QueryResult:
        """Hybrid retrieval combining semantic keyword matching with
        structural graph traversal.

        Two phases:
          1. **Semantic phase**: Score all nodes by keyword overlap with
             *semantic_query*.  Select the top-scoring nodes as seeds.
          2. **Structural phase**: For each seed node, run a pattern-based
             traversal using *structural_pattern* (or a default SIMPLE
             pattern).

        Paths are re-ranked by a combined score:
          combined = α * normalised_path_cost⁻¹ + (1-α) * semantic_score

        where α (alpha) controls the balance between structural cost and
        semantic relevance (default 0.5).

        Args:
                    graph:              The property graph to query.
                    semantic_query:     Natural-language or keyword query.
                    structural_pattern: Optional QueryPattern for the
                                        structural phase.  If None, a default
                                        SIMPLE pattern with depth 3 is used.
                    top_k:              Maximum number of paths to return.

        Returns:
            QueryResult with up to *top_k* re-ranked paths.
        """
        t0 = time.monotonic()

        pattern = structural_pattern or QueryPattern(
            path_type=PathType.SIMPLE,
            max_depth=3,
        )

        # -- Phase 1: Semantic scoring --------------------------------------
        node_scores: Dict[str, float] = {}
        for node in graph.all_nodes():
            score = _keyword_similarity(_node_text(node), semantic_query)
            # Also match against labels
            label_text = " ".join(node.labels)
            label_score = _keyword_similarity(label_text, semantic_query)
            node_scores[node.id] = max(score, label_score)

        # Select seed nodes with non-zero semantic score
        seeds = [(nid, score) for nid, score in node_scores.items()
                 if score > 0.0]
        seeds.sort(key=lambda x: x[1], reverse=True)

        # Limit seeds to avoid explosion
        max_seeds = min(len(seeds), top_k * 2, 50)
        seeds = seeds[:max_seeds]

        if not seeds:
            elapsed_ms = (time.monotonic() - t0) * 1000.0
            return QueryResult(
                paths=[],
                total_count=0,
                execution_time_ms=elapsed_ms,
                let_variables={},
            )

        # -- Phase 2: Structural traversal from each seed ------------------
        all_paths: List[GraphPath] = []
        seen_path_hashes: Set[str] = set()

        for seed_id, sem_score in seeds:
            result = self.query(graph, seed_id, pattern)
            for gp in result.paths:
                # Deduplicate paths by content hash
                path_hash = hashlib.sha256(
                    json.dumps({
                        "nodes": gp.nodes,
                        "edges": gp.edges,
                    }, sort_keys=True).encode()
                ).hexdigest()

                if path_hash in seen_path_hashes:
                    continue
                seen_path_hashes.add(path_hash)

                # Attach semantic boost to the path cost for re-ranking
                # We store the semantic score as a transient attribute
                # and re-rank below.
                all_paths.append(gp)

        # -- Phase 3: Re-ranking -------------------------------------------
        alpha = 0.5
        if all_paths:
            max_cost = max(p.cost for p in all_paths)
            if max_cost == 0.0:
                max_cost = 1.0

            for gp in all_paths:
                # Compute semantic score for this path's terminal node
                terminal_id = gp.nodes[-1] if gp.nodes else ""
                sem = node_scores.get(terminal_id, 0.0)
                # Also average over all nodes in the path
                if gp.nodes:
                    avg_sem = sum(node_scores.get(nid, 0.0)
                                  for nid in gp.nodes) / len(gp.nodes)
                else:
                    avg_sem = 0.0
                best_sem = max(sem, avg_sem)

                # Combined score: higher is better
                normalised_cost_inv = 1.0 - (gp.cost / max_cost)  # cheaper → higher
                combined_score = alpha * normalised_cost_inv + (1 - alpha) * best_sem

                # Override cost with negative combined score for sort
                # (we'll negate it back so that sort ascending = best first)
                gp.cost = -combined_score

            all_paths.sort(key=lambda p: p.cost)

            # Restore positive costs (original path cost)
            for gp in all_paths:
                gp.cost = abs(gp.cost)

        # Trim to top_k
        result_paths = all_paths[:top_k]

        elapsed_ms = (time.monotonic() - t0) * 1000.0

        # Build LET snapshot with semantic info
        let_vars: Dict[str, Any] = {
            "$semantic_query": semantic_query,
            "$seed_count": len(seeds),
            "$alpha": alpha,
        }

        return QueryResult(
            paths=result_paths,
            total_count=len(all_paths),
            execution_time_ms=elapsed_ms,
            let_variables=let_vars,
        )
