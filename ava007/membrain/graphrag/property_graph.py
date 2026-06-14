"""
property_graph.py — ISO/IEC 39075:2024 Property Graph Model for QAG-MemBrain (Layer 3).

Implements the core property graph data structure following the GQL standard concepts:
  - Nodes with multiple labels and arbitrary properties
  - Directed edges with typed relationships and properties
  - Property filtering with equality and range operators (gt, lt, gte, lte, ne)
  - Subgraph extraction by node ID sets
  - Adjacency-based neighbor and edge lookups

This module is the foundation for the GraphRAG retrieval engine.
"""

from __future__ import annotations

import copy
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set, Tuple


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class Node:
    """A node in the property graph (ISO/IEC 39075:2024 vertex concept).

    Attributes:
        id:        Unique identifier for the node.
        labels:    Ordered list of labels (analogous to GQL labels / node types).
        properties: Arbitrary key-value properties attached to this node.
    """
    id: str
    labels: List[str] = field(default_factory=list)
    properties: Dict[str, Any] = field(default_factory=dict)

    def has_label(self, label: str) -> bool:
        """Return True if this node carries *label*."""
        return label in self.labels

    def get_property(self, key: str, default: Any = None) -> Any:
        """Return a property value, or *default* if absent."""
        return self.properties.get(key, default)

    def __repr__(self) -> str:  # pragma: no cover
        lbl = ":".join(self.labels)
        return f"Node({self.id!r} [{lbl}])"


@dataclass
class Edge:
    """A directed edge in the property graph (ISO/IEC 39075:2024 edge concept).

    Attributes:
        id:         Unique identifier for the edge.
        source:     ID of the source node.
        target:     ID of the target node.
        type:       Relationship type string (analogous to GQL edge type).
        properties: Arbitrary key-value properties attached to this edge.
    """
    id: str
    source: str
    target: str
    type: str
    properties: Dict[str, Any] = field(default_factory=dict)

    def get_property(self, key: str, default: Any = None) -> Any:
        """Return a property value, or *default* if absent."""
        return self.properties.get(key, default)

    @property
    def weight(self) -> float:
        """Convenience: read the ``weight`` property, defaulting to 1.0."""
        return float(self.properties.get("weight", 1.0))

    def __repr__(self) -> str:  # pragma: no cover
        return f"Edge({self.id!r} {self.source!r}-[{self.type}]->{self.target!r})"


# ---------------------------------------------------------------------------
# Property filter helpers
# ---------------------------------------------------------------------------

def _match_property_filter(properties: Dict[str, Any],
                           prop_filter: Dict[str, Any]) -> bool:
    """Evaluate a property filter against a property dict.

    Filter semantics:
      - ``{"key": value}`` — exact equality check
      - ``{"key": {"gt": v}}``  — property > v
      - ``{"key": {"lt": v}}``  — property < v
      - ``{"key": {"gte": v}}`` — property >= v
      - ``{"key": {"lte": v}}`` — property <= v
      - ``{"key": {"ne": v}}``  — property != v

    Multiple keys in the filter are ANDed.  If a property key is absent from
    *properties* the filter for that key fails (returns False) unless the
    filter is a ``ne`` check.
    """
    for key, condition in prop_filter.items():
        if key not in properties:
            # Absent property: only passes a "ne" check against non-None
            if isinstance(condition, dict) and "ne" in condition:
                return True  # absent != value is True
            return False

        actual = properties[key]

        if isinstance(condition, dict):
            for op, val in condition.items():
                if op == "gt":
                    if not (actual > val):
                        return False
                elif op == "lt":
                    if not (actual < val):
                        return False
                elif op == "gte":
                    if not (actual >= val):
                        return False
                elif op == "lte":
                    if not (actual <= val):
                        return False
                elif op == "ne":
                    if not (actual != val):
                        return False
                else:
                    raise ValueError(f"Unknown filter operator: {op!r}")
        else:
            # Equality
            if actual != condition:
                return False
    return True


# ---------------------------------------------------------------------------
# PropertyGraph
# ---------------------------------------------------------------------------

class PropertyGraph:
    """In-memory property graph following ISO/IEC 39075:2024 concepts.

    Supports multiple labels per node, directed typed edges, property
    filtering with equality and range operators, and subgraph extraction.
    """

    def __init__(self, name: str = "default") -> None:
        self.name: str = name
        self._nodes: Dict[str, Node] = {}
        self._edges: Dict[str, Edge] = {}
        # Adjacency maps: node_id -> list of edge ids
        self._outgoing: Dict[str, List[str]] = {}
        self._incoming: Dict[str, List[str]] = {}
        # Index: label -> set of node ids
        self._label_index: Dict[str, Set[str]] = {}
        # Index: edge type -> set of edge ids
        self._type_index: Dict[str, Set[str]] = {}

    # -- Mutating operations ------------------------------------------------

    def add_node(self, id: str, labels: Optional[List[str]] = None,
                 properties: Optional[Dict[str, Any]] = None) -> Node:
        """Add a node to the graph.  Returns the created Node.

        If a node with the same id already exists, its labels and properties
        are updated (labels are merged, properties overwritten by key).
        """
        labels = labels or []
        properties = properties or {}

        if id in self._nodes:
            # Merge semantics for duplicate id
            existing = self._nodes[id]
            for lbl in labels:
                if lbl not in existing.labels:
                    existing.labels.append(lbl)
                    self._label_index.setdefault(lbl, set()).add(id)
            existing.properties.update(properties)
            return existing

        node = Node(id=id, labels=list(labels), properties=dict(properties))
        self._nodes[id] = node
        self._outgoing.setdefault(id, [])
        self._incoming.setdefault(id, [])

        for lbl in labels:
            self._label_index.setdefault(lbl, set()).add(id)

        return node

    def add_edge(self, id: str, source: str, target: str, type: str,
                 properties: Optional[Dict[str, Any]] = None) -> Edge:
        """Add a directed edge.  Returns the created Edge.

        Raises:
            KeyError: If *source* or *target* node does not exist.
            ValueError: If an edge with *id* already exists.
        """
        if source not in self._nodes:
            raise KeyError(f"Source node {source!r} not found in graph")
        if target not in self._nodes:
            raise KeyError(f"Target node {target!r} not found in graph")
        if id in self._edges:
            raise ValueError(f"Edge id {id!r} already exists in graph")

        properties = properties or {}
        edge = Edge(id=id, source=source, target=target, type=type,
                    properties=dict(properties))
        self._edges[id] = edge
        self._outgoing.setdefault(source, []).append(id)
        self._incoming.setdefault(target, []).append(id)
        self._type_index.setdefault(type, set()).add(id)
        return edge

    # -- Read operations ----------------------------------------------------

    def get_node(self, id: str) -> Optional[Node]:
        """Return the node with *id*, or None."""
        return self._nodes.get(id)

    def get_edge(self, id: str) -> Optional[Edge]:
        """Return the edge with *id*, or None."""
        return self._edges.get(id)

    def get_neighbors(self, node_id: str,
                      direction: str = "both") -> List[Node]:
        """Return neighboring nodes.

        Args:
            node_id:   The node to find neighbors for.
            direction: ``'out'`` for outgoing, ``'in'`` for incoming,
                       ``'both'`` for either direction (default).

        Raises:
            KeyError: If *node_id* does not exist.
        """
        if node_id not in self._nodes:
            raise KeyError(f"Node {node_id!r} not found in graph")

        neighbor_ids: Set[str] = set()

        if direction in ("out", "both"):
            for eid in self._outgoing.get(node_id, []):
                neighbor_ids.add(self._edges[eid].target)

        if direction in ("in", "both"):
            for eid in self._incoming.get(node_id, []):
                neighbor_ids.add(self._edges[eid].source)

        return [self._nodes[nid] for nid in neighbor_ids if nid in self._nodes]

    def get_edges_between(self, source: str, target: str) -> List[Edge]:
        """Return all edges from *source* to *target*."""
        results: List[Edge] = []
        for eid in self._outgoing.get(source, []):
            edge = self._edges[eid]
            if edge.target == target:
                results.append(edge)
        return results

    def query_nodes(self, label: str,
                    property_filter: Optional[Dict[str, Any]] = None) -> List[Node]:
        """Find all nodes with *label* that match *property_filter*.

        If *property_filter* is None, all nodes with the label are returned.
        """
        candidate_ids = self._label_index.get(label, set())
        results: List[Node] = []
        for nid in candidate_ids:
            node = self._nodes[nid]
            if property_filter is None or _match_property_filter(
                    node.properties, property_filter):
                results.append(node)
        return results

    def query_edges(self, type: str,
                    property_filter: Optional[Dict[str, Any]] = None) -> List[Edge]:
        """Find all edges of *type* that match *property_filter*.

        If *property_filter* is None, all edges of the type are returned.
        """
        candidate_ids = self._type_index.get(type, set())
        results: List[Edge] = []
        for eid in candidate_ids:
            edge = self._edges[eid]
            if property_filter is None or _match_property_filter(
                    edge.properties, property_filter):
                results.append(edge)
        return results

    def subgraph(self, node_ids: Set[str]) -> "PropertyGraph":
        """Extract a subgraph containing only the specified node IDs.

        All edges whose source AND target are in *node_ids* are included.
        """
        sg = PropertyGraph(name=f"{self.name}_sub")
        for nid in node_ids:
            if nid in self._nodes:
                n = self._nodes[nid]
                sg.add_node(n.id, list(n.labels), dict(n.properties))
        for eid, edge in self._edges.items():
            if edge.source in node_ids and edge.target in node_ids:
                sg.add_edge(edge.id, edge.source, edge.target, edge.type,
                            dict(edge.properties))
        return sg

    def node_count(self) -> int:
        """Return the number of nodes in the graph."""
        return len(self._nodes)

    def edge_count(self) -> int:
        """Return the number of edges in the graph."""
        return len(self._edges)

    def all_nodes(self) -> List[Node]:
        """Return all nodes in the graph."""
        return list(self._nodes.values())

    def all_edges(self) -> List[Edge]:
        """Return all edges in the graph."""
        return list(self._edges.values())

    def has_node(self, id: str) -> bool:
        """Return True if a node with *id* exists."""
        return id in self._nodes

    def has_edge(self, id: str) -> bool:
        """Return True if an edge with *id* exists."""
        return id in self._edges

    def remove_node(self, id: str) -> None:
        """Remove a node and all its incident edges from the graph.

        Raises:
            KeyError: If the node does not exist.
        """
        if id not in self._nodes:
            raise KeyError(f"Node {id!r} not found in graph")

        # Collect edge ids to remove
        edges_to_remove: List[str] = (
            list(self._outgoing.get(id, []))
            + list(self._incoming.get(id, []))
        )

        for eid in edges_to_remove:
            self.remove_edge(eid)

        # Clean label index
        node = self._nodes[id]
        for lbl in node.labels:
            lbl_set = self._label_index.get(lbl)
            if lbl_set is not None:
                lbl_set.discard(id)
                if not lbl_set:
                    del self._label_index[lbl]

        del self._nodes[id]
        self._outgoing.pop(id, None)
        self._incoming.pop(id, None)

    def remove_edge(self, id: str) -> None:
        """Remove an edge from the graph.

        Raises:
            KeyError: If the edge does not exist.
        """
        if id not in self._edges:
            raise KeyError(f"Edge {id!r} not found in graph")

        edge = self._edges[id]
        # Remove from adjacency lists
        if id in self._outgoing.get(edge.source, []):
            self._outgoing[edge.source].remove(id)
        if id in self._incoming.get(edge.target, []):
            self._incoming[edge.target].remove(id)

        # Remove from type index
        type_set = self._type_index.get(edge.type)
        if type_set is not None:
            type_set.discard(id)
            if not type_set:
                del self._type_index[edge.type]

        del self._edges[id]

    def shortest_path(self, source: str, target: str,
                      weight_key: str = "weight") -> Optional[Tuple[List[str], List[str], float]]:
        """Dijkstra shortest path between *source* and *target*.

        Returns:
            A tuple of (node_ids, edge_ids, total_cost), or None if
            no path exists.

        Raises:
            KeyError: If source or target node does not exist.
        """
        if source not in self._nodes:
            raise KeyError(f"Source node {source!r} not found")
        if target not in self._nodes:
            raise KeyError(f"Target node {target!r} not found")

        import heapq

        # (cost, node_id, path_nodes, path_edges)
        heap: List[Tuple[float, str, List[str], List[str]]] = [(0.0, source, [source], [])]
        visited: Dict[str, float] = {}

        while heap:
            cost, current, nodes, edges = heapq.heappop(heap)

            if current == target:
                return (nodes, edges, cost)

            if current in visited and visited[current] <= cost:
                continue
            visited[current] = cost

            for eid in self._outgoing.get(current, []):
                edge = self._edges[eid]
                edge_cost = float(edge.properties.get(weight_key, 1.0))
                new_cost = cost + edge_cost
                next_node = edge.target
                if next_node not in visited or visited[next_node] > new_cost:
                    heapq.heappush(heap,
                                   (new_cost, next_node,
                                    nodes + [next_node], edges + [eid]))

        return None

    def __repr__(self) -> str:  # pragma: no cover
        return (f"PropertyGraph({self.name!r}, "
                f"nodes={self.node_count()}, edges={self.edge_count()})")
