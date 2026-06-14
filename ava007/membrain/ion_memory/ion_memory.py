"""
ion_memory.py — Core Filament State Store for the QAG-MemBrain Ion Memory Layer

The ``IonMemoryStore`` is the primary public interface for L1 ion memory.
It manages a collection of memristor-like filament entries whose values are
3-bit MLC conductance levels (0-7).  Every write passes through the
``EnduranceTracker`` to enforce write-cycle budgets and the ``MLCEmulation``
module for level validation.  Events are emitted for observability.

Typical usage::

    from ava007.membrain.ion_memory import IonMemoryStore

    store = IonMemoryStore()
    store.create_filament("neuron_42", initial_level=3)
    level = store.read_filament("neuron_42")   # → 3
    store.write_filament("neuron_42", 5)
    store.delete_filament("neuron_42")
"""

from __future__ import annotations

import enum
import logging
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from .endurance import EnduranceTracker, FilamentHealth
from .filament_store import FilamentStore, FilamentStoreBase
from .mlc_emulation import MLCEmulation

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Event system
# ---------------------------------------------------------------------------

class IonEventKind(enum.Enum):
    """Event types emitted by ``IonMemoryStore``."""
    CREATE = "create"
    READ = "read"
    WRITE = "write"
    DELETE = "delete"
    WRITE_BLOCKED = "write_blocked"      # endurance exhausted
    WRITE_FATIGUED = "write_fatigued"    # fatigue warning


@dataclass
class IonEvent:
    """An observable event from the ion memory store."""
    kind: IonEventKind
    key: str
    level: Optional[int] = None
    timestamp: float = field(default_factory=time.monotonic)
    metadata: Dict[str, Any] = field(default_factory=dict)


# Event callback type
EventListener = Callable[[IonEvent], None]


# ---------------------------------------------------------------------------
# IonMemoryStore
# ---------------------------------------------------------------------------

class IonMemoryStore:
    """High-level filament state store with endurance tracking and events.

    Parameters
    ----------
    db_path : str | Path | None
        Path to the backing SQLite database.  *None* creates a temp file.
    mlc : MLCEmulation | None
        Custom MLC emulator instance.  A default is created if *None*.
    endurance : EnduranceTracker | None
        Custom endurance tracker.  A default is created if *None*.
    """

    def __init__(
        self,
        db_path: str | Path | None = None,
        mlc: MLCEmulation | None = None,
        endurance: EnduranceTracker | None = None,
    ) -> None:
        self._mlc = mlc or MLCEmulation()
        self._store = FilamentStore(path=db_path, mlc=self._mlc)
        self._endurance = endurance or EnduranceTracker(store=self._store)
        self._listeners: List[EventListener] = []

    # ------------------------------------------------------------------
    # Event helpers
    # ------------------------------------------------------------------

    def _emit(self, event: IonEvent) -> None:
        """Dispatch *event* to all registered listeners."""
        for listener in self._listeners:
            try:
                listener(event)
            except Exception:
                logger.exception("Event listener raised an exception for %s", event)

    def add_listener(self, listener: EventListener) -> None:
        """Register a callback to receive ``IonEvent`` notifications."""
        self._listeners.append(listener)

    def remove_listener(self, listener: EventListener) -> bool:
        """Remove a previously registered listener.  Returns *True* if found."""
        try:
            self._listeners.remove(listener)
            return True
        except ValueError:
            return False

    # ------------------------------------------------------------------
    # Core CRUD
    # ------------------------------------------------------------------

    def create_filament(self, key: str, initial_level: int = 0) -> None:
        """Create a new filament with the given *initial_level*.

        If the key already exists the existing entry is **overwritten** (same
        as ``write_filament``), but a CREATE event is emitted instead of a
        WRITE event.

        Raises
        ------
        ValueError
            If *initial_level* is not a valid MLC level (0-7).
        """
        if not self._mlc.validate_level(initial_level):
            raise ValueError(
                f"Invalid initial MLC level {initial_level!r}; must be 0-7."
            )

        # Check endurance — block if dead
        if self._endurance.is_dead(key):
            self._emit(IonEvent(
                kind=IonEventKind.WRITE_BLOCKED,
                key=key,
                level=initial_level,
                metadata={"reason": "endurance_exhausted"},
            ))
            logger.warning(
                "Create blocked for %r — endurance exhausted.", key
            )
            return

        self._store.put(key, initial_level)
        self._endurance.increment(key)

        if self._endurance.is_fatigued(key):
            self._emit(IonEvent(
                kind=IonEventKind.WRITE_FATIGUED,
                key=key,
                level=initial_level,
                metadata={
                    "fatigue_factor": self._endurance.fatigue_factor(key),
                    "remaining_cycles": self._endurance.remaining_cycles(key),
                },
            ))

        self._emit(IonEvent(
            kind=IonEventKind.CREATE,
            key=key,
            level=initial_level,
        ))

    def read_filament(self, key: str) -> int:
        """Read the conductance level for *key*.

        Returns
        -------
        int
            The MLC level (0-7).

        Raises
        ------
        KeyError
            If *key* does not exist.
        """
        level = self._store.get(key)
        if level is None:
            raise KeyError(f"Filament {key!r} does not exist.")

        self._emit(IonEvent(
            kind=IonEventKind.READ,
            key=key,
            level=level,
        ))
        return level

    def write_filament(self, key: str, level: int) -> None:
        """Write a new conductance *level* to an existing filament.

        The write is **rejected** (with a WRITE_BLOCKED event) if the
        filament's endurance has been exhausted.  A WRITE_FATIGUED event is
        emitted if the cell is in the fatigue zone but still writable.

        Raises
        ------
        KeyError
            If *key* does not exist (use ``create_filament`` first).
        ValueError
            If *level* is not a valid MLC level.
        """
        if not self._mlc.validate_level(level):
            raise ValueError(f"Invalid MLC level {level!r}; must be 0-7.")

        existing = self._store.get(key)
        if existing is None:
            raise KeyError(
                f"Filament {key!r} does not exist. "
                "Use create_filament() first."
            )

        # Endurance gate — block dead cells
        if self._endurance.is_dead(key):
            self._emit(IonEvent(
                kind=IonEventKind.WRITE_BLOCKED,
                key=key,
                level=level,
                metadata={"reason": "endurance_exhausted"},
            ))
            logger.warning(
                "Write blocked for %r — endurance exhausted.", key
            )
            return

        self._store.put(key, level)
        self._endurance.increment(key)

        if self._endurance.is_fatigued(key):
            self._emit(IonEvent(
                kind=IonEventKind.WRITE_FATIGUED,
                key=key,
                level=level,
                metadata={
                    "fatigue_factor": self._endurance.fatigue_factor(key),
                    "remaining_cycles": self._endurance.remaining_cycles(key),
                },
            ))

        self._emit(IonEvent(
            kind=IonEventKind.WRITE,
            key=key,
            level=level,
        ))

    def delete_filament(self, key: str) -> bool:
        """Delete a filament by *key*.

        Returns
        -------
        bool
            *True* if the filament existed and was removed.
        """
        deleted = self._store.delete(key)
        if deleted:
            self._endurance.reset(key)
            self._emit(IonEvent(
                kind=IonEventKind.DELETE,
                key=key,
            ))
        return deleted

    # ------------------------------------------------------------------
    # Query helpers
    # ------------------------------------------------------------------

    def has_filament(self, key: str) -> bool:
        """Return *True* if *key* exists in the store."""
        return self._store.get(key) is not None

    def list_keys(self) -> List[str]:
        """Return all filament keys."""
        return self._store.keys()

    def count(self) -> int:
        """Return the number of filaments."""
        return self._store.count()

    def all_items(self) -> Dict[str, int]:
        """Return a ``{key: level}`` dict of all filaments."""
        return self._store.get_all_as_dict()

    # ------------------------------------------------------------------
    # MLC helpers (delegated)
    # ------------------------------------------------------------------

    def level_to_conductance(self, level: int) -> float:
        """Map an MLC level to conductance (μS)."""
        return self._mlc.level_to_conductance(level)

    def level_to_resistance(self, level: int) -> float:
        """Map an MLC level to resistance (kΩ)."""
        return self._mlc.level_to_resistance(level)

    def add_noise(self, level: int, sigma: float = 0.1) -> int:
        """Add analog noise to a level (delegates to MLCEmulation)."""
        return self._mlc.add_noise(level, sigma=sigma)

    # ------------------------------------------------------------------
    # Endurance helpers (delegated)
    # ------------------------------------------------------------------

    def get_write_count(self, key: str) -> int:
        """Return the write-cycle count for *key*."""
        return self._endurance.get_count(key)

    def fatigue_factor(self, key: str) -> float:
        """Return the fatigue factor for *key*."""
        return self._endurance.fatigue_factor(key)

    def filament_health(self, key: str) -> FilamentHealth:
        """Return the health classification for *key*."""
        return self._endurance.health(key)

    def remaining_cycles(self, key: str) -> int:
        """Return remaining write cycles for *key*."""
        return self._endurance.remaining_cycles(key)

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    @property
    def store(self) -> FilamentStoreBase:
        """Access the underlying ``FilamentStore``."""
        return self._store

    @property
    def mlc(self) -> MLCEmulation:
        """Access the MLC emulation module."""
        return self._mlc

    @property
    def endurance(self) -> EnduranceTracker:
        """Access the endurance tracker."""
        return self._endurance

    def close(self) -> None:
        """Close the backing store and release resources."""
        if isinstance(self._store, FilamentStore):
            self._store.close()

    def __repr__(self) -> str:
        return (
            f"IonMemoryStore(filaments={self.count()}, "
            f"endurance={self._endurance!r})"
        )
