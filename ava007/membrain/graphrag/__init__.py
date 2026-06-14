"""
QAG-MemBrain GraphRAG Layer (Layer 3: GQL GraphRAG Retrieval)

Property graph retrieval following ISO/IEC 39075:2024 GQL standard concepts,
with path restrictors, LET variable support, and schema validation.

Exports:
    GraphRAGRetrieval   — Core retrieval engine
    PropertyGraph       — ISO/IEC 39075:2024 property graph model
    Node                — Graph node data structure
    Edge                — Graph edge data structure
    PathType            — WALK / TRAIL / ACYCLIC / SIMPLE enum
    PathRestrictor      — Abstract path restrictor base class
    get_restrictor      — Factory for PathRestrictor instances
    traverse_with_restrictor — Restricted graph traversal
    GraphPath           — Path result structure
    GQLLetBindings      — GQL LET variable binding container
    SchemaValidator     — Closed Graph Type DDL validator
    QueryPattern        — Query pattern descriptor
    QueryResult         — Query result container
    NodeTypeSchema      — Node type DDL schema
    EdgeTypeSchema      — Edge type DDL schema
    ValidationResult    — Single-entity validation result
    GraphValidationResult — Whole-graph validation result
"""

from .graphrag_retrieval import (
    GraphRAGRetrieval,
    QueryPattern,
    QueryResult,
)
from .gql_let import GQLLetBindings
from .path_restrictors import (
    GraphPath,
    PathRestrictor,
    PathType,
    get_restrictor,
    traverse_with_restrictor,
)
from .property_graph import (
    Edge,
    Node,
    PropertyGraph,
)
from .schema_validator import (
    EdgeTypeSchema,
    GraphValidationResult,
    NodeTypeSchema,
    SchemaValidator,
    ValidationResult,
)

__all__ = [
    # Core engine
    "GraphRAGRetrieval",
    "QueryPattern",
    "QueryResult",
    # Property graph
    "PropertyGraph",
    "Node",
    "Edge",
    # Path restrictors
    "PathType",
    "PathRestrictor",
    "get_restrictor",
    "traverse_with_restrictor",
    "GraphPath",
    # LET bindings
    "GQLLetBindings",
    # Schema validation
    "SchemaValidator",
    "NodeTypeSchema",
    "EdgeTypeSchema",
    "ValidationResult",
    "GraphValidationResult",
]
