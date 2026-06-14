"""
schema_validator.py — Closed Graph Type DDL Validation for QAG-MemBrain (Layer 3).

Implements "closed" graph schema validation following ISO/IEC 39075:2024 GQL
graph type concepts:

  - NodeTypeSchema: defines required/optional properties, expected labels,
    and their Python types for a given node type.
  - EdgeTypeSchema: defines source/target node type constraints,
    required/optional properties, and their Python types for a given edge type.
  - SchemaValidator: validates PropertyGraph instances against the defined
    schema, reporting errors and warnings.

"Closed" means that any property on a node or edge that is not declared in
the schema is flagged — as a validation error in *strict* mode, or as a
warning in *permissive* mode.

Supported Python types for property type checking: ``str``, ``int``,
``float``, ``bool``, ``list``, ``dict``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set, Type

from .property_graph import Edge, Node, PropertyGraph


# ---------------------------------------------------------------------------
# Schema data structures
# ---------------------------------------------------------------------------

# The set of Python types we support for DDL type checking.
SUPPORTED_TYPES: Set[Type] = {str, int, float, bool, list, dict}

# Map from Python type to a human-readable name for error messages.
_TYPE_NAMES: Dict[Type, str] = {
    str: "str",
    int: "int",
    float: "float",
    bool: "bool",
    list: "list",
    dict: "dict",
}


@dataclass
class NodeTypeSchema:
    """Schema definition for a node type in the closed graph DDL.

    Attributes:
        name:                Node type name (e.g. ``"Person"``).
        required_properties: Mapping of property name → expected Python type
                             for properties that MUST be present.
        optional_properties: Mapping of property name → expected Python type
                             for properties that MAY be present.
        labels:              Expected GQL labels for nodes of this type.
    """
    name: str
    required_properties: Dict[str, Type] = field(default_factory=dict)
    optional_properties: Dict[str, Type] = field(default_factory=dict)
    labels: List[str] = field(default_factory=list)


@dataclass
class EdgeTypeSchema:
    """Schema definition for an edge type in the closed graph DDL.

    Attributes:
        name:                Edge type name (e.g. ``"KNOWS"``).
        source_node_type:    Required node type name of the source endpoint.
        target_node_type:    Required node type name of the target endpoint.
        required_properties: Mapping of property name → expected Python type.
        optional_properties: Mapping of property name → expected Python type.
    """
    name: str
    source_node_type: str = ""
    target_node_type: str = ""
    required_properties: Dict[str, Type] = field(default_factory=dict)
    optional_properties: Dict[str, Type] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Validation results
# ---------------------------------------------------------------------------

@dataclass
class ValidationResult:
    """Result of validating a single node or edge against the schema.

    Attributes:
        valid:    True if no errors were found.
        errors:   List of error messages (blocking).
        warnings: List of warning messages (non-blocking).
    """
    valid: bool = True
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)

    def add_error(self, msg: str) -> None:
        self.errors.append(msg)
        self.valid = False

    def add_warning(self, msg: str) -> None:
        self.warnings.append(msg)

    def merge(self, other: "ValidationResult") -> None:
        """Merge another ValidationResult into this one (in-place)."""
        self.errors.extend(other.errors)
        self.warnings.extend(other.warnings)
        if not other.valid:
            self.valid = False


@dataclass
class GraphValidationResult:
    """Aggregate validation result for an entire PropertyGraph.

    Attributes:
        valid:         True if all nodes and edges passed validation.
        node_results:  Mapping of node ID → ValidationResult.
        edge_results:  Mapping of edge ID → ValidationResult.
    """
    valid: bool = True
    node_results: Dict[str, ValidationResult] = field(default_factory=dict)
    edge_results: Dict[str, ValidationResult] = field(default_factory=dict)

    def add_node_result(self, node_id: str, result: ValidationResult) -> None:
        self.node_results[node_id] = result
        if not result.valid:
            self.valid = False

    def add_edge_result(self, edge_id: str, result: ValidationResult) -> None:
        self.edge_results[edge_id] = result
        if not result.valid:
            self.valid = False

    @property
    def total_errors(self) -> int:
        return sum(len(r.errors) for r in
                   list(self.node_results.values()) +
                   list(self.edge_results.values()))

    @property
    def total_warnings(self) -> int:
        return sum(len(r.warnings) for r in
                   list(self.node_results.values()) +
                   list(self.edge_results.values()))


# ---------------------------------------------------------------------------
# Type checking helper
# ---------------------------------------------------------------------------

def _check_type(value: Any, expected_type: Type) -> bool:
    """Check whether *value* is an instance of *expected_type*.

    Special handling:
      - ``int`` is accepted for ``float`` expectations (numeric coercion).
      - ``bool`` is NOT accepted for ``int`` expectations (bool is a
        subclass of int in Python, but for schema purposes they differ).
    """
    if expected_type is float and isinstance(value, int) and not isinstance(value, bool):
        # Allow int where float is expected (e.g., 1 is valid for float)
        return True
    if expected_type is int and isinstance(value, bool):
        # bool is NOT a valid int for schema purposes
        return False
    return isinstance(value, expected_type)


def _type_name(t: Type) -> str:
    """Return a human-readable name for a Python type."""
    return _TYPE_NAMES.get(t, getattr(t, "__name__", str(t)))


# ---------------------------------------------------------------------------
# SchemaValidator
# ---------------------------------------------------------------------------

class SchemaValidator:
    """Closed Graph Type DDL validator.

    Define node and edge type schemas, then validate PropertyGraph instances
    against them.  In strict mode, any undeclared property is an error; in
    permissive mode, it is a warning.

    Each node/edge is matched to its schema by:
      - Nodes: matched by labels — if a node carries a label that matches a
        NodeTypeSchema's name, that schema applies.  A node may match
        multiple schemas; all are checked.
      - Edges: matched by edge ``type`` field against EdgeTypeSchema names.
    """

    def __init__(self, strict: bool = True) -> None:
        """Initialise the validator.

        Args:
            strict: If True (default), undeclared properties are errors.
                    If False, undeclared properties are warnings.
        """
        self.strict = strict
        self._node_schemas: Dict[str, NodeTypeSchema] = {}
        self._edge_schemas: Dict[str, EdgeTypeSchema] = {}

    # -- Schema definition --------------------------------------------------

    def define_node_type(self, schema: NodeTypeSchema) -> None:
        """Register a node type schema.

        Raises:
            ValueError: If a node type with the same name is already defined,
                        or if any declared type is not in SUPPORTED_TYPES.
        """
        if schema.name in self._node_schemas:
            raise ValueError(
                f"Node type {schema.name!r} is already defined")

        # Validate declared types
        for prop_name, prop_type in schema.required_properties.items():
            if prop_type not in SUPPORTED_TYPES:
                raise ValueError(
                    f"Unsupported type {_type_name(prop_type)!r} for "
                    f"required property {prop_name!r} in node type "
                    f"{schema.name!r}")
        for prop_name, prop_type in schema.optional_properties.items():
            if prop_type not in SUPPORTED_TYPES:
                raise ValueError(
                    f"Unsupported type {_type_name(prop_type)!r} for "
                    f"optional property {prop_name!r} in node type "
                    f"{schema.name!r}")

        self._node_schemas[schema.name] = schema

    def define_edge_type(self, schema: EdgeTypeSchema) -> None:
        """Register an edge type schema.

        Raises:
            ValueError: If an edge type with the same name is already defined,
                        or if source/target node types have not been defined,
                        or if any declared type is not in SUPPORTED_TYPES.
        """
        if schema.name in self._edge_schemas:
            raise ValueError(
                f"Edge type {schema.name!r} is already defined")

        if schema.source_node_type and schema.source_node_type not in self._node_schemas:
            raise ValueError(
                f"Source node type {schema.source_node_type!r} is not defined")
        if schema.target_node_type and schema.target_node_type not in self._node_schemas:
            raise ValueError(
                f"Target node type {schema.target_node_type!r} is not defined")

        for prop_name, prop_type in schema.required_properties.items():
            if prop_type not in SUPPORTED_TYPES:
                raise ValueError(
                    f"Unsupported type {_type_name(prop_type)!r} for "
                    f"required property {prop_name!r} in edge type "
                    f"{schema.name!r}")
        for prop_name, prop_type in schema.optional_properties.items():
            if prop_type not in SUPPORTED_TYPES:
                raise ValueError(
                    f"Unsupported type {_type_name(prop_type)!r} for "
                    f"optional property {prop_name!r} in edge type "
                    f"{schema.name!r}")

        self._edge_schemas[schema.name] = schema

    # -- Validation helpers -------------------------------------------------

    def _find_node_schemas(self, node: Node) -> List[NodeTypeSchema]:
        """Find all NodeTypeSchema that apply to *node* based on its labels."""
        matched: List[NodeTypeSchema] = []
        for label in node.labels:
            if label in self._node_schemas:
                matched.append(self._node_schemas[label])
        return matched

    def _validate_properties(self,
                             properties: Dict[str, Any],
                             required: Dict[str, Type],
                             optional: Dict[str, Type],
                             entity_kind: str,
                             entity_id: str,
                             schema_name: str) -> ValidationResult:
        """Validate a property dict against required/optional schemas."""
        result = ValidationResult()
        declared = set(required.keys()) | set(optional.keys())

        # Check required properties
        for prop_name, prop_type in required.items():
            if prop_name not in properties:
                result.add_error(
                    f"{entity_kind} {entity_id!r} (schema {schema_name!r}): "
                    f"missing required property {prop_name!r}")
            elif not _check_type(properties[prop_name], prop_type):
                actual_type_name = _type_name(type(properties[prop_name]))
                result.add_error(
                    f"{entity_kind} {entity_id!r} (schema {schema_name!r}): "
                    f"property {prop_name!r} expected type "
                    f"{_type_name(prop_type)}, got {actual_type_name}")

        # Check optional properties (type only if present)
        for prop_name, prop_type in optional.items():
            if prop_name in properties:
                if not _check_type(properties[prop_name], prop_type):
                    actual_type_name = _type_name(type(properties[prop_name]))
                    result.add_error(
                        f"{entity_kind} {entity_id!r} (schema {schema_name!r}): "
                        f"optional property {prop_name!r} expected type "
                        f"{_type_name(prop_type)}, got {actual_type_name}")

        # Closed schema: check for undeclared properties
        for prop_name in properties:
            if prop_name not in declared:
                msg = (f"{entity_kind} {entity_id!r} (schema {schema_name!r}): "
                       f"undeclared property {prop_name!r}")
                if self.strict:
                    result.add_error(msg)
                else:
                    result.add_warning(msg)

        return result

    # -- Public validation API ----------------------------------------------

    def validate_node(self, node: Node) -> ValidationResult:
        """Validate a single node against all matching schemas.

        If the node carries no labels that match any defined NodeTypeSchema,
        a warning is emitted (or an error in strict mode) about the
        unrecognised node type.
        """
        matched_schemas = self._find_node_schemas(node)

        if not matched_schemas:
            result = ValidationResult()
            msg = (f"Node {node.id!r} has no matching node type schema "
                   f"(labels: {node.labels})")
            if self.strict:
                result.add_error(msg)
            else:
                result.add_warning(msg)
            return result

        # Validate against all matching schemas
        combined = ValidationResult()
        for schema in matched_schemas:
            vr = self._validate_properties(
                node.properties,
                schema.required_properties,
                schema.optional_properties,
                "Node", node.id, schema.name,
            )
            combined.merge(vr)

            # Check expected labels
            for expected_label in schema.labels:
                if not node.has_label(expected_label):
                    combined.add_warning(
                        f"Node {node.id!r} (schema {schema.name!r}): "
                        f"expected label {expected_label!r} not present")

        return combined

    def validate_edge(self, edge: Edge, graph: PropertyGraph) -> ValidationResult:
        """Validate a single edge against all matching schemas.

        Also checks source/target node type constraints.

        Args:
            edge:  The edge to validate.
            graph: The graph containing the edge's endpoints (needed for
                   node type lookups).
        """
        schema = self._edge_schemas.get(edge.type)

        if schema is None:
            result = ValidationResult()
            msg = (f"Edge {edge.id!r} has no matching edge type schema "
                   f"(type: {edge.type!r})")
            if self.strict:
                result.add_error(msg)
            else:
                result.add_warning(msg)
            return result

        result = self._validate_properties(
            edge.properties,
            schema.required_properties,
            schema.optional_properties,
            "Edge", edge.id, schema.name,
        )

        # Source node type constraint
        if schema.source_node_type:
            source_node = graph.get_node(edge.source)
            if source_node is None:
                result.add_error(
                    f"Edge {edge.id!r}: source node {edge.source!r} "
                    f"not found in graph")
            elif not source_node.has_label(schema.source_node_type):
                result.add_error(
                    f"Edge {edge.id!r} (schema {schema.name!r}): "
                    f"source node {edge.source!r} does not have label "
                    f"{schema.source_node_type!r}")

        # Target node type constraint
        if schema.target_node_type:
            target_node = graph.get_node(edge.target)
            if target_node is None:
                result.add_error(
                    f"Edge {edge.id!r}: target node {edge.target!r} "
                    f"not found in graph")
            elif not target_node.has_label(schema.target_node_type):
                result.add_error(
                    f"Edge {edge.id!r} (schema {schema.name!r}): "
                    f"target node {edge.target!r} does not have label "
                    f"{schema.target_node_type!r}")

        return result

    def validate_graph(self, graph: PropertyGraph) -> GraphValidationResult:
        """Validate all nodes and edges in *graph* against the schema.

        Returns a GraphValidationResult with per-node and per-edge results.
        """
        result = GraphValidationResult()

        for node in graph.all_nodes():
            vr = self.validate_node(node)
            result.add_node_result(node.id, vr)

        for edge in graph.all_edges():
            vr = self.validate_edge(edge, graph)
            result.add_edge_result(edge.id, vr)

        return result

    # -- Introspection ------------------------------------------------------

    def node_type_names(self) -> List[str]:
        """Return a sorted list of defined node type names."""
        return sorted(self._node_schemas.keys())

    def edge_type_names(self) -> List[str]:
        """Return a sorted list of defined edge type names."""
        return sorted(self._edge_schemas.keys())

    def get_node_type_schema(self, name: str) -> Optional[NodeTypeSchema]:
        """Return the NodeTypeSchema for *name*, or None."""
        return self._node_schemas.get(name)

    def get_edge_type_schema(self, name: str) -> Optional[EdgeTypeSchema]:
        """Return the EdgeTypeSchema for *name*, or None."""
        return self._edge_schemas.get(name)
