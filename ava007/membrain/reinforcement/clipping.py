"""
QAG-MemBrain Layer 4: Asymmetric Epsilon Clipping
===================================================
Implements asymmetric clipping for the GRPO/DAPO policy optimization.

Standard PPO uses symmetric clipping: ratio is clipped to [1-eps, 1+eps].
However, GRPO benefits from asymmetric clipping where the upper bound is
wider than the lower bound, allowing more exploration in the direction
of positive advantage while still preventing destructively large updates.

Rationale:
    - When advantage > 0: the policy wants to increase the probability of
      the action. A wider upper clip (epsilon_high) allows more aggressive
      updates toward higher-reward actions.
    - When advantage < 0: the policy wants to decrease the probability.
      The tighter lower clip (epsilon_low) prevents overshooting.

Default asymmetric bounds: epsilon_low=0.2, epsilon_high=0.3
This allows ratios up to 1.3 for positive-advantage actions vs. only
down to 0.8 for negative-advantage actions.
"""

import math
from typing import List, Tuple


class AsymmetricClipping:
    """
    Asymmetric epsilon clipping for policy ratio constraints.

    Unlike standard PPO's symmetric clipping, this allows different bounds
    for the upper and lower clip, enabling controlled asymmetric exploration.
    Also provides adaptive epsilon computation based on advantage variance.
    """

    def __init__(self, epsilon_low: float = 0.2, epsilon_high: float = 0.3):
        """
        Args:
            epsilon_low: Lower clip distance from 1.0 (default 0.2 → floor 0.8).
            epsilon_high: Upper clip distance from 1.0 (default 0.3 → ceiling 1.3).
        """
        self.epsilon_low = epsilon_low
        self.epsilon_high = epsilon_high

    def clip(self, ratio: float, epsilon_low: float = 0.0,
             epsilon_high: float = 0.0) -> float:
        """
        Apply asymmetric clipping to a single ratio.

        Clips the ratio to the range [1 - epsilon_low, 1 + epsilon_high].

        Args:
            ratio: Importance sampling ratio.
            epsilon_low: Lower clip epsilon. Uses instance default if 0.
            epsilon_high: Upper clip epsilon. Uses instance default if 0.

        Returns:
            Clipped ratio.
        """
        el = epsilon_low if epsilon_low > 0 else self.epsilon_low
        eh = epsilon_high if epsilon_high > 0 else self.epsilon_high
        lower = 1.0 - el
        upper = 1.0 + eh
        return max(lower, min(upper, ratio))

    def clip_ratios(self, ratios: List[float], epsilon_low: float = 0.0,
                    epsilon_high: float = 0.0) -> List[float]:
        """
        Apply asymmetric clipping to a list of ratios.

        Args:
            ratios: List of importance sampling ratios.
            epsilon_low: Lower clip epsilon. Uses instance default if 0.
            epsilon_high: Upper clip epsilon. Uses instance default if 0.

        Returns:
            List of clipped ratios.
        """
        return [self.clip(r, epsilon_low, epsilon_high) for r in ratios]

    def is_clipped(self, ratio: float, epsilon_low: float = 0.0,
                   epsilon_high: float = 0.0) -> bool:
        """
        Check whether a ratio falls outside the clipping range.

        Args:
            ratio: Importance sampling ratio.
            epsilon_low: Lower clip epsilon. Uses instance default if 0.
            epsilon_high: Upper clip epsilon. Uses instance default if 0.

        Returns:
            True if the ratio would be clipped.
        """
        el = epsilon_low if epsilon_low > 0 else self.epsilon_low
        eh = epsilon_high if epsilon_high > 0 else self.epsilon_high
        lower = 1.0 - el
        upper = 1.0 + eh
        return ratio < lower or ratio > upper

    def clip_count(self, ratios: List[float], epsilon_low: float = 0.0,
                   epsilon_high: float = 0.0) -> int:
        """
        Count how many ratios would be clipped.

        Args:
            ratios: List of importance sampling ratios.
            epsilon_low: Lower clip epsilon. Uses instance default if 0.
            epsilon_high: Upper clip epsilon. Uses instance default if 0.

        Returns:
            Number of ratios outside the clipping range.
        """
        return sum(
            1 for r in ratios if self.is_clipped(r, epsilon_low, epsilon_high)
        )

    def adaptive_epsilon(self, advantages: List[float],
                         base_epsilon: float = 0.2) -> Tuple[float, float]:
        """
        Compute adaptive clipping bounds based on advantage variance.

        When advantages have high variance, the policy is less certain about
        action quality. Wider clipping allows the optimizer to make larger
        corrections. When variance is low, tighter clipping provides more
        stability.

        The formula scales epsilon by the log of advantage variance:
            scale = 1 + log(1 + std(advantages))
            epsilon_low = base_epsilon
            epsilon_high = base_epsilon * scale

        This ensures epsilon_high >= epsilon_low, with the gap growing
        as advantage variance increases.

        Args:
            advantages: List of advantage values.
            base_epsilon: Base clipping parameter.

        Returns:
            Tuple of (epsilon_low, epsilon_high).
        """
        if not advantages:
            return (base_epsilon, base_epsilon * 1.5)

        n = len(advantages)
        mean = sum(advantages) / n
        variance = sum((a - mean) ** 2 for a in advantages) / n
        std = math.sqrt(variance)

        # Scale factor based on advantage standard deviation
        # Higher variance → wider upper clip → more exploration
        scale = 1.0 + math.log(1.0 + std)

        epsilon_low = base_epsilon
        epsilon_high = base_epsilon * scale

        return (epsilon_low, epsilon_high)
