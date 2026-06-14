"""
path_restrictors.py — Path Restrictor Implementations for QAG-MemBrain (Layer 3).

Implements the four ISO/IEC 39075:2024 GQL path types:

  - WALK:    No restrictions — nodes and edges may repeat freely.
  - TRAIL:   Edges may NOT repeat, but nodes can.
  - ACYCLIC: The path must be acyclic — no node may repeat.
  - SIMPLE:  No repeated nodes AND no repeated edges.

Each restrictor is a callable that checks whether extending a partial path
with a candidate (next_node, next_edge) still satisfies the constraint.

Also provides ``traverse_with_restrictor`` which performs a DFS traversal
of a PropertyGraph while respecting a given path restrictor and maximum
depth bound.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Set

from .property_graph import Edge, Node, PropertyGraph


# ---------------------------------------------------------------------------
# PathType enum
# ---------------------------------------------------------------------------

class PathType(Enum):
    """ISO/IEC 39075:2024 GQL path type enumeration."""
    WALK = "WALK"
    TRAIL = "TRAIL"
    ACYCLIC = "ACYCLIC"
    SIMPLE = "SIMPLE"


# ---------------------------------------------------------------------------
# GraphPath result structure
# ---------------------------------------------------------------------------

@dataclass
class GraphPath:
    """A path through the property graph.

    Attributes:
        nodes:     Ordered list of node IDs in the path.
        edges:     Ordered list of edge IDs in the path.
        cost:      Sum of edge weights along the path.
        path_type: The PathType that was enforced during traversal.
    """
    nodes: List[str] = field(default_factory=list)
    edges: List[str] = field(default_factory=list)
    cost: float = 0.0
    path_type: PathType = PathType.WALK

    def __len__(self) -> int:
        """Return the number of edges in the path (path length)."""
        return len(self.edges)

    def __repr__(self) -> str:  # pragma: no cover
        node_str = " -> ".join(self.nodes)
        return (f"GraphPath({node_str}, cost={self.cost}, "
                f"type={self.path_type.value})")


# ---------------------------------------------------------------------------
# Abstract PathRestrictor
# ---------------------------------------------------------------------------

class PathRestrictor(ABC):
    """Abstract base for path restrictors.

    Subclasses implement the ``check`` method which decides whether a
    candidate (next_node, next_edge) can extend the current partial path
    while still satisfying the path-type constraint.
    """

    @abstractmethod
    def check(self, path: List[str], edges: List[str],
              next_node: str, next_edge: str) -> bool:
        """Return True if extending *path* with (*next_node*, *next_edge*)
        is allowed under this restrictor's constraint.

        Args:
            path:       Node IDs visited so far (including start).
            edges:      Edge IDs traversed so far.
            next_node:  Candidate node to extend to.
            next_edge:  Candidate edge to traverse.
        """
        ...

    @abstractmethod
    def name(self) -> PathType:
        """Return the PathType this restrictor enforces."""
        ...


# ---------------------------------------------------------------------------
# Concrete restrictors
# ---------------------------------------------------------------------------

class WalkRestrictor(PathRestrictor):
    """WALK: no restrictions — nodes and edges can repeat."""

    def check(self, path: List[str], edges: List[str],
              next_node: str, next_edge: str) -> bool:
        return True

    def name(self) -> PathType:
        return PathType.WALK


class TrailRestrictor(PathRestrictor):
    """TRAIL: edges may not repeat, nodes can."""

    def check(self, path: List[str], edges: List[str],
              next_node: str, next_edge: str) -> bool:
        return next_edge not in edges

    def name(self) -> PathType:
        return PathType.TRAIL


class AcyclicRestrictor(PathRestrictor):
    """ACYCLIC: no node may repeat (the path is acyclic)."""

    def check(self, path: List[str], edges: List[str],
              next_node: str, next_edge: str) -> bool:
        return next_node not in path

    def name(self) -> PathType:
        return PathType.ACYCLIC


class SimpleRestrictor(PathRestrictor):
    """SIMPLE: no repeated nodes AND no repeated edges."""

    def check(self, path: List[str], edges: List[str],
              next_node: str, next_edge: str) -> bool:
        return (next_node not in path) and (next_edge not in edges)

    def name(self) -> PathType:
        return PathType.SIMPLE


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------

_RESTRICTOR_MAP: Dict[PathType, type] = {
    PathType.WALK: WalkRestrictor,
    PathType.TRAIL: TrailRestrictor,
    PathType.ACYCLIC: AcyclicRestrictor,
    PathType.SIMPLE: SimpleRestrictor,
}


def get_restrictor(path_type: PathType) -> PathRestrictor:
    """Factory: return a PathRestrictor instance for the given PathType.

    Raises:
        ValueError: If *path_type* is not a known PathType.
    """
    cls = _RESTRICTOR_MAP.get(path_type)
    if cls is None:
        raise ValueError(f"Unknown PathType: {path_type!r}")
    return cls()


# ---------------------------------------------------------------------------
# Traversal
# ---------------------------------------------------------------------------

def traverse_with_restrictor(
    graph: PropertyGraph,
    start: str,
    path_type: PathType,
    max_depth: int = 5,
    edge_types: Optional[List[str]] = None,
    node_labels: Optional[List[str]] = None,
    weight_key: str = "weight",
) -> List[GraphPath]:
    """DFS traversal of *graph* from *start* respecting *path_type*.

    Explores all paths up to *max_depth* edges that satisfy the path
    restrictor.  Optionally filters by *edge_types* (only traverse edges
    whose type is in the list) and *node_labels* (only visit nodes that
    carry at least one of the specified labels).

    Args:
        graph:       The property graph to traverse.
        start:       Node ID to start from.
        path_type:   Which path constraint to enforce.
        max_depth:   Maximum number of edges in a path.
        edge_types:  If given, only traverse edges whose type is in this list.
        node_labels: If given, only visit nodes carrying one of these labels.
        weight_key:  Property key used to read edge weights for cost.

    Returns:
        A list of GraphPath objects (one per discovered path), sorted by
        cost ascending.

    Raises:
        KeyError: If *start* node does not exist in the graph.
    """
    if not graph.has_node(start):
        raise KeyError(f"Start node {start!r} not found in graph")

    restrictor = get_restrictor(path_type)
    results: List[GraphPath] = []

    # Stack entries: (current_node_id, path_node_ids, path_edge_ids, cost_so_far, depth)
    stack: List[tuple] = [(start, [start], [], 0.0, 0)]

    while stack:
        current, node_path, edge_path, cost, depth = stack.pop()

        # A path of at least one edge is a valid result
        if depth > 0:
            results.append(GraphPath(
                nodes=list(node_path),
                edges=list(edge_path),
                cost=cost,
                path_type=path_type,
            ))

        # Stop expanding at max depth
        if depth >= max_depth:
            continue

        # Explore outgoing edges
        for eid in graph._outgoing.get(current, []):
            edge = graph.get_edge(eid)
            if edge is None:
                continue

            # Edge type filter
            if edge_types is not None and edge.type not in edge_types:
                continue

            next_node_id = edge.target

            # Node label filter
            if node_labels is not None:
                next_node = graph.get_node(next_node_id)
                if next_node is None:
                    continue
                if not any(next_node.has_label(lbl) for lbl in node_labels):
                    continue

            # Restrictor check
            if not restrictor.check(node_path, edge_path,
                                    next_node_id, eid):
                continue

            edge_cost = float(edge.properties.get(weight_key, 1.0))
            new_cost = cost + edge_cost

            stack.append((
                next_node_id,
                node_path + [next_node_id],
                edge_path + [eid],
                new_cost,
                depth + 1,
            ))

    # Sort results by cost ascending
    results.sort(key=lambda p: p.cost)
    return results
