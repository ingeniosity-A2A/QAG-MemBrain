"""
mlc_emulation.py — 8-level (3-bit) MLC Conductance Emulation

Emulates multi-level cell memristor conductance states for the QAG-MemBrain
ion_memory layer. Provides level validation, conductance/resistance mapping,
linear interpolation in conductance space, and analog noise injection.

Conductance levels 0-7 map exponentially to microsiemens:
    Level 0 → 1 uS   (R = 1000 kΩ)
    Level 1 → 2 uS   (R = 500 kΩ)
    Level 2 → 4 uS   (R = 250 kΩ)
    Level 3 → 8 uS   (R = 125 kΩ)
    Level 4 → 16 uS  (R = 62.5 kΩ)
    Level 5 → 32 uS  (R = 31.25 kΩ)
    Level 6 → 64 uS  (R = 15.625 kΩ)
    Level 7 → 128 uS (R = 7.8125 kΩ)
"""

from __future__ import annotations

import math
import random
from typing import Dict, Final, List, Tuple

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

NUM_LEVELS: Final[int] = 8          # 3-bit MLC → 8 levels (0..7)
MIN_LEVEL: Final[int] = 0
MAX_LEVEL: Final[int] = NUM_LEVELS - 1  # 7

# Exponential conductance mapping: level → conductance in microsiemens (μS)
# G(level) = 2^level  μS  →  1, 2, 4, 8, 16, 32, 64, 128
CONDUCTANCE_MAP: Dict[int, float] = {lvl: float(2 ** lvl) for lvl in range(NUM_LEVELS)}

# Resistance mapping: level → resistance in kilohms (kΩ)
# R = 1 / G   (with unit conversion: 1 μS = 1 / 1000 kΩ⁻¹ → R_kΩ = 1000 / G_μS)
RESISTANCE_MAP: Dict[int, float] = {
    lvl: 1000.0 / CONDUCTANCE_MAP[lvl] for lvl in range(NUM_LEVELS)
}


class MLCEmulation:
    """Multi-Level Cell conductance emulation for memristor filament states.

    Provides:
      - Level validation (0-7)
      - Conductance / resistance look-ups
      - Reverse mapping from conductance back to nearest level
      - Linear interpolation in conductance space
      - Gaussian noise injection (analog variability model)
    """

    # ------------------------------------------------------------------
    # Construction
    # ------------------------------------------------------------------

    def __init__(self, seed: int | None = None) -> None:
        """Initialise the MLC emulator.

        Parameters
        ----------
        seed : int | None
            Optional RNG seed for reproducible noise.  When *None* the
            default Python RNG state is used.
        """
        self._rng = random.Random(seed)
        # Pre-compute a sorted list of (conductance, level) for reverse lookup
        self._cond_levels: List[Tuple[float, int]] = sorted(
            ((CONDUCTANCE_MAP[lvl], lvl) for lvl in range(NUM_LEVELS)),
            key=lambda pair: pair[0],
        )

    # ------------------------------------------------------------------
    # Validation
    # ------------------------------------------------------------------

    @staticmethod
    def validate_level(level: int) -> bool:
        """Return *True* if *level* is a valid MLC level (0-7)."""
        return isinstance(level, int) and MIN_LEVEL <= level <= MAX_LEVEL

    # ------------------------------------------------------------------
    # Forward mappings
    # ------------------------------------------------------------------

    @staticmethod
    def level_to_conductance(level: int) -> float:
        """Map an MLC *level* to conductance in microsiemens (μS).

        Raises
        ------
        ValueError
            If *level* is outside [0, 7].
        """
        if not MLCEmulation.validate_level(level):
            raise ValueError(f"Invalid MLC level {level!r}; must be 0-7.")
        return CONDUCTANCE_MAP[level]

    @staticmethod
    def level_to_resistance(level: int) -> float:
        """Map an MLC *level* to resistance in kilohms (kΩ).

        Raises
        ------
        ValueError
            If *level* is outside [0, 7].
        """
        if not MLCEmulation.validate_level(level):
            raise ValueError(f"Invalid MLC level {level!r}; must be 0-7.")
        return RESISTANCE_MAP[level]

    # ------------------------------------------------------------------
    # Reverse mapping
    # ------------------------------------------------------------------

    def conductance_to_level(self, conductance: float) -> int:
        """Convert a conductance value (μS) to the nearest MLC level.

        The mapping finds the level whose nominal conductance is closest
        to the supplied value, clamping to the valid range.

        Parameters
        ----------
        conductance : float
            Conductance in microsiemens.

        Returns
        -------
        int
            Nearest valid MLC level (0-7).
        """
        if conductance <= CONDUCTANCE_MAP[0]:
            return 0
        if conductance >= CONDUCTANCE_MAP[MAX_LEVEL]:
            return MAX_LEVEL

        best_level = 0
        best_dist = float("inf")
        for cond, lvl in self._cond_levels:
            dist = abs(cond - conductance)
            if dist < best_dist:
                best_dist = dist
                best_level = lvl
        return best_level

    # ------------------------------------------------------------------
    # Interpolation
    # ------------------------------------------------------------------

    def interpolate(self, level_a: int, level_b: int, weight: float) -> int:
        """Linearly interpolate between two MLC levels in conductance space.

        The interpolation is performed on the conductance values so that the
        result respects the exponential spacing of the levels.

        Parameters
        ----------
        level_a : int
            Start level (0-7).
        level_b : int
            End level (0-7).
        weight : float
            Interpolation weight in [0.0, 1.0].  0.0 → *level_a*, 1.0 → *level_b*.

        Returns
        -------
        int
            Nearest MLC level to the interpolated conductance.

        Raises
        ------
        ValueError
            If either level is invalid or weight is outside [0, 1].
        """
        if not self.validate_level(level_a):
            raise ValueError(f"Invalid level_a {level_a!r}; must be 0-7.")
        if not self.validate_level(level_b):
            raise ValueError(f"Invalid level_b {level_b!r}; must be 0-7.")
        if not 0.0 <= weight <= 1.0:
            raise ValueError(f"Weight must be in [0.0, 1.0], got {weight!r}.")

        cond_a = CONDUCTANCE_MAP[level_a]
        cond_b = CONDUCTANCE_MAP[level_b]
        interp_cond = cond_a + weight * (cond_b - cond_a)
        return self.conductance_to_level(interp_cond)

    # ------------------------------------------------------------------
    # Noise injection
    # ------------------------------------------------------------------

    def add_noise(self, level: int, sigma: float = 0.1) -> int:
        """Add Gaussian noise to a conductance level and return the nearest valid level.

        Models analog variability in memristor filament states.  The noise is
        applied in conductance space (μS) with standard deviation *sigma*
        expressed as a fraction of the nominal conductance for *level*.

        Parameters
        ----------
        level : int
            The nominal MLC level (0-7).
        sigma : float
            Relative standard deviation of the noise (default 0.1 = 10 %).

        Returns
        -------
        int
            Noisy level, clamped to [0, 7].

        Raises
        ------
        ValueError
            If *level* is invalid.
        """
        if not self.validate_level(level):
            raise ValueError(f"Invalid MLC level {level!r}; must be 0-7.")

        cond = CONDUCTANCE_MAP[level]
        noisy_cond = self._rng.gauss(cond, sigma * cond)
        # Clamp to positive
        noisy_cond = max(0.0, noisy_cond)
        return self.conductance_to_level(noisy_cond)

    # ------------------------------------------------------------------
    # Utility
    # ------------------------------------------------------------------

    def all_levels(self) -> List[int]:
        """Return a list of all valid MLC levels [0, 1, …, 7]."""
        return list(range(NUM_LEVELS))

    def conductance_table(self) -> Dict[int, Dict[str, float]]:
        """Return the full level → {conductance, resistance} mapping."""
        return {
            lvl: {
                "conductance_uS": CONDUCTANCE_MAP[lvl],
                "resistance_kOhm": RESISTANCE_MAP[lvl],
            }
            for lvl in range(NUM_LEVELS)
        }

    def __repr__(self) -> str:
        return f"MLCEmulation(levels={NUM_LEVELS})"
