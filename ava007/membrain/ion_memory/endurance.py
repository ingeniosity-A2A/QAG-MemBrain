"""
endurance.py — Write Cycle Tracking & Fatigue Model for Ion Memory Filaments

Models the endurance characteristics of ReRAM / memristor filament cells.
Each filament has a finite write budget (default 100 000 cycles, typical for
TaOx/HfO2 ReRAM).  The ``EnduranceTracker`` monitors write counts, computes
fatigue factors, and flags cells approaching their end-of-life.

Fatigue model:
    fatigue_factor(key) = 1.0 - (write_count / MAX_WRITE_CYCLES)

    At 0 writes   → fatigue_factor = 1.0  (fresh)
    At 80 000     → fatigue_factor = 0.2   (< FATIGUE_THRESHOLD, flagged)
    At 100 000    → fatigue_factor = 0.0   (dead — writes blocked)
"""

from __future__ import annotations

import enum
import logging
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Set

from .filament_store import FilamentStoreBase

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

MAX_WRITE_CYCLES: int = 100_000       # Typical ReRAM endurance
FATIGUE_THRESHOLD: float = 0.8        # Fatigue onset at 80 % of max cycles


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

class FilamentHealth(enum.Enum):
    """Health classification for a filament cell."""
    HEALTHY = "healthy"
    FATIGUED = "fatigued"
    DEAD = "dead"


@dataclass
class EnduranceRecord:
    """Per-filament endurance state."""
    key: str
    write_count: int = 0
    last_written_at: float = 0.0      # monotonic clock
    health: FilamentHealth = FilamentHealth.HEALTHY


# ---------------------------------------------------------------------------
# EnduranceTracker
# ---------------------------------------------------------------------------

class EnduranceTracker:
    """Track write-cycle counts and compute fatigue for ion-memory filaments.

    The tracker maintains an in-memory register of per-filament write counts
    and can optionally persist counts to a ``FilamentStore`` backend.

    Parameters
    ----------
    max_write_cycles : int
        Maximum number of write cycles before a cell is considered dead.
    fatigue_threshold : float
        Fraction of *max_write_cycles* at which fatigue onset is flagged
        (0.0–1.0).  When ``fatigue_factor`` drops below
        ``(1 - fatigue_threshold)`` the cell is marked fatigued.
    store : FilamentStoreBase | None
        Optional persistent store.  When provided, the tracker will read
        initial write counts from the store and persist increments.
    """

    def __init__(
        self,
        max_write_cycles: int = MAX_WRITE_CYCLES,
        fatigue_threshold: float = FATIGUE_THRESHOLD,
        store: FilamentStoreBase | None = None,
    ) -> None:
        self._max_write_cycles = max_write_cycles
        self._fatigue_threshold = fatigue_threshold
        self._store = store
        self._records: Dict[str, EnduranceRecord] = {}

        # Bootstrap from persistent store if available
        if self._store is not None:
            self._bootstrap_from_store()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _bootstrap_from_store(self) -> None:
        """Load write counts from the persistent store on startup."""
        if self._store is None:
            return
        for key in self._store.keys():
            wc = self._store.get_write_count(key)
            if wc > 0:
                rec = EnduranceRecord(
                    key=key,
                    write_count=wc,
                    health=self._classify_health(wc),
                )
                self._records[key] = rec

    def _classify_health(self, write_count: int) -> FilamentHealth:
        """Derive health from a raw write count."""
        if write_count >= self._max_write_cycles:
            return FilamentHealth.DEAD
        ff = 1.0 - (write_count / self._max_write_cycles)
        if ff <= (1.0 - self._fatigue_threshold):
            return FilamentHealth.FATIGUED
        return FilamentHealth.HEALTHY

    def _ensure_record(self, key: str) -> EnduranceRecord:
        """Return the record for *key*, creating one if necessary."""
        if key not in self._records:
            self._records[key] = EnduranceRecord(key=key)
        return self._records[key]

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def increment(self, key: str) -> int:
        """Increment the write counter for *key* and return the new count.

        If the cell has exceeded its maximum write cycles the counter is
        **still** incremented (for accounting) but the health flag will
        be set to ``DEAD`` and a warning is emitted.

        Returns
        -------
        int
            The updated write count.
        """
        import time as _time

        rec = self._ensure_record(key)
        rec.write_count += 1
        rec.last_written_at = _time.monotonic()
        rec.health = self._classify_health(rec.write_count)

        if rec.health == FilamentHealth.DEAD:
            logger.warning(
                "Filament %r has exceeded max write cycles "
                "(%d / %d).  Writes should be blocked.",
                key,
                rec.write_count,
                self._max_write_cycles,
            )
        elif rec.health == FilamentHealth.FATIGUED:
            logger.info(
                "Filament %r is fatigued (write count %d / %d, "
                "fatigue_factor=%.3f).",
                key,
                rec.write_count,
                self._max_write_cycles,
                self.fatigue_factor(key),
            )

        return rec.write_count

    def get_count(self, key: str) -> int:
        """Return the current write count for *key* (0 if never written)."""
        return self._records.get(key, EnduranceRecord(key=key)).write_count

    def is_fatigued(self, key: str) -> bool:
        """Return *True* if *key* is in the FATIGUED or DEAD state."""
        rec = self._records.get(key)
        if rec is None:
            return False
        return rec.health in (FilamentHealth.FATIGUED, FilamentHealth.DEAD)

    def is_dead(self, key: str) -> bool:
        """Return *True* if *key* has exhausted its write budget."""
        rec = self._records.get(key)
        if rec is None:
            return False
        return rec.health == FilamentHealth.DEAD

    def remaining_cycles(self, key: str) -> int:
        """Return how many more write cycles *key* can tolerate."""
        return max(0, self._max_write_cycles - self.get_count(key))

    def fatigue_factor(self, key: str) -> float:
        """Compute the fatigue factor for *key*.

        Returns a float in [0.0, 1.0] where:
            1.0 = fresh (0 writes)
            0.0 = dead  (>= max_write_cycles writes)

        The factor decreases **linearly** with write count.
        """
        wc = self.get_count(key)
        return max(0.0, 1.0 - (wc / self._max_write_cycles))

    def health(self, key: str) -> FilamentHealth:
        """Return the current ``FilamentHealth`` classification."""
        rec = self._records.get(key)
        if rec is None:
            return FilamentHealth.HEALTHY
        return rec.health

    # ------------------------------------------------------------------
    # Bulk queries
    # ------------------------------------------------------------------

    def fatigued_keys(self) -> List[str]:
        """Return keys that are FATIGUED (but not yet DEAD)."""
        return [
            k for k, r in self._records.items()
            if r.health == FilamentHealth.FATIGUED
        ]

    def dead_keys(self) -> List[str]:
        """Return keys that are DEAD."""
        return [
            k for k, r in self._records.items()
            if r.health == FilamentHealth.DEAD
        ]

    def all_records(self) -> Dict[str, EnduranceRecord]:
        """Return a shallow copy of all endurance records."""
        return dict(self._records)

    def reset(self, key: str) -> None:
        """Reset the endurance record for *key* (as if the cell was replaced)."""
        self._records.pop(key, None)

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------

    @property
    def max_write_cycles(self) -> int:
        return self._max_write_cycles

    @property
    def fatigue_threshold(self) -> float:
        return self._fatigue_threshold

    def __repr__(self) -> str:
        n_healthy = sum(
            1 for r in self._records.values()
            if r.health == FilamentHealth.HEALTHY
        )
        n_fatigued = sum(
            1 for r in self._records.values()
            if r.health == FilamentHealth.FATIGUED
        )
        n_dead = sum(
            1 for r in self._records.values()
            if r.health == FilamentHealth.DEAD
        )
        return (
            f"EnduranceTracker(tracked={len(self._records)}, "
            f"healthy={n_healthy}, fatigued={n_fatigued}, dead={n_dead})"
        )
