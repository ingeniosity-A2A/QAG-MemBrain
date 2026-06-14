"""
gql_let.py — GQL LET Variable Binding Support for QAG-MemBrain (Layer 3).

Implements the LET variable concept from ISO/IEC 39075:2024 GQL:

  LET $threshold = 0.8
  LET $category  = "person"
  MATCH (n)-[e]->(m) WHERE n.score > $threshold

LET variables allow naming intermediate query results, parameterizing
queries, and passing context between query stages within the GraphRAG
retrieval engine.

This module provides the ``GQLLetBindings`` class which manages a mutable
scope of named bindings with merge, serialization, and resolution support.
"""

from __future__ import annotations

import copy
from typing import Any, Dict, Iterator, List, Optional, Tuple


class GQLLetBindings:
    """GQL LET variable bindings container.

    Follows the ISO/IEC 39075:2024 LET concept: variables are named with
    a leading ``$`` convention (e.g., ``$threshold``) but the class stores
    them without the ``$`` prefix for convenience.  Both ``$name`` and
    ``name`` resolve to the same binding.

    Bindings are mutable and can be merged (later bindings override earlier
    ones for the same name).
    """

    def __init__(self) -> None:
        self._bindings: Dict[str, Any] = {}

    # -- Normalisation ------------------------------------------------------

    @staticmethod
    def _norm_key(name: str) -> str:
        """Normalise a variable name by stripping a leading ``$`` if present.

        This allows both ``$threshold`` and ``threshold`` to refer to the
        same binding.
        """
        if name.startswith("$"):
            return name[1:]
        return name

    # -- Core API -----------------------------------------------------------

    def bind(self, name: str, value: Any) -> None:
        """Bind *name* to *value* in this scope.

        If *name* is already bound, the previous value is overwritten.

        Args:
            name:  Variable name (with or without leading ``$``).
            value: Any Python object.
        """
        key = self._norm_key(name)
        self._bindings[key] = value

    def resolve(self, name: str) -> Any:
        """Resolve the value of *name*.

        Args:
            name: Variable name (with or without leading ``$``).

        Returns:
            The bound value.

        Raises:
            KeyError: If *name* is not bound in this scope.
        """
        key = self._norm_key(name)
        if key not in self._bindings:
            raise KeyError(
                f"GQL LET variable ${key} is not bound. "
                f"Available bindings: {list(self._bindings.keys())}"
            )
        return self._bindings[key]

    def resolve_or(self, name: str, default: Any = None) -> Any:
        """Resolve *name*, returning *default* if unbound.

        Unlike ``resolve``, this never raises ``KeyError``.
        """
        key = self._norm_key(name)
        return self._bindings.get(key, default)

    def is_bound(self, name: str) -> bool:
        """Return True if *name* has a binding in this scope."""
        return self._norm_key(name) in self._bindings

    # -- Merge / copy -------------------------------------------------------

    def merge(self, other: "GQLLetBindings") -> "GQLLetBindings":
        """Create a new GQLLetBindings by merging *other* into this one.

        Bindings from *other* override bindings from ``self`` when names
        collide.  Neither ``self`` nor *other* are mutated.
        """
        result = GQLLetBindings()
        # Start with self's bindings (deep copy to avoid aliasing)
        result._bindings = copy.deepcopy(self._bindings)
        # Override with other's bindings
        for key, value in other._bindings.items():
            result._bindings[key] = copy.deepcopy(value)
        return result

    def update(self, other: "GQLLetBindings") -> None:
        """In-place merge: bindings from *other* override those in ``self``.

        This mutates ``self``.
        """
        for key, value in other._bindings.items():
            self._bindings[key] = copy.deepcopy(value)

    # -- Serialization ------------------------------------------------------

    def to_dict(self) -> Dict[str, Any]:
        """Return a plain dict of bindings (deep copy).

        Keys are stored *without* the ``$`` prefix.
        """
        return copy.deepcopy(self._bindings)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "GQLLetBindings":
        """Construct a GQLLetBindings from a plain dict.

        Each key-value pair in *data* becomes a binding.  Keys may or may
        not have a leading ``$`` — they will be normalised.
        """
        bindings = cls()
        for key, value in data.items():
            bindings.bind(key, value)
        return bindings

    # -- Introspection ------------------------------------------------------

    def names(self) -> List[str]:
        """Return a sorted list of bound variable names (without ``$``)."""
        return sorted(self._bindings.keys())

    def items(self) -> Iterator[Tuple[str, Any]]:
        """Iterate over (name, value) pairs (without ``$`` prefix)."""
        for key in sorted(self._bindings.keys()):
            yield key, self._bindings[key]

    def count(self) -> int:
        """Return the number of bound variables."""
        return len(self._bindings)

    def clear(self) -> None:
        """Remove all bindings."""
        self._bindings.clear()

    # -- Dunder methods -----------------------------------------------------

    def __contains__(self, name: str) -> bool:
        return self.is_bound(name)

    def __getitem__(self, name: str) -> Any:
        return self.resolve(name)

    def __setitem__(self, name: str, value: Any) -> None:
        self.bind(name, value)

    def __len__(self) -> int:
        return self.count()

    def __repr__(self) -> str:  # pragma: no cover
        items = ", ".join(f"${k}={v!r}" for k, v in sorted(self._bindings.items()))
        return f"GQLLetBindings({items})"

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, GQLLetBindings):
            return NotImplemented
        return self._bindings == other._bindings
