"""
QAG-MemBrain Layer 4: Group-Normalized Reward Scoring
======================================================
Provides reward normalization, baseline subtraction, and multi-signal
reward combination for the GRPO/DAPO training loop.

Key idea: Raw reward signals vary in scale and distribution. Before
computing advantages, rewards must be normalized to zero mean and unit
variance within each group. Additional utilities handle moving baselines,
rank normalization, and weighted combination of multiple reward signals.
"""

import math
from typing import List, Tuple
from dataclasses import dataclass


@dataclass
class NormalizedRewards:
    """Container for group-normalized reward statistics."""
    raw: List[float]
    mean: float
    std: float
    normalized: List[float]


class RewardScorer:
    """
    Group-normalized reward scoring with multiple normalization strategies.

    Supports:
        - Group z-score normalization (subtract mean, divide by std)
        - Baseline subtraction with an external moving average
        - Exponential moving average for online baseline tracking
        - Rank normalization for non-parametric scoring
        - Weighted combination of task, format, and safety rewards
    """

    # ------------------------------------------------------------------
    # Group normalization
    # ------------------------------------------------------------------

    def score_group(self, rewards: List[float]) -> NormalizedRewards:
        """
        Normalize rewards within a group using z-score.

        Computes population mean and standard deviation, then normalizes:
            normalized_i = (r_i - mean) / std

        If all rewards are identical (std = 0), normalized values are 0.0.

        Args:
            rewards: List of raw reward values.

        Returns:
            NormalizedRewards containing raw values, statistics, and
            normalized values.
        """
        n = len(rewards)
        if n == 0:
            return NormalizedRewards(raw=[], mean=0.0, std=0.0, normalized=[])

        mean = sum(rewards) / n
        # Population standard deviation
        variance = sum((r - mean) ** 2 for r in rewards) / n
        std = math.sqrt(variance)

        if std < 1e-12:
            normalized = [0.0] * n
        else:
            normalized = [(r - mean) / std for r in rewards]

        return NormalizedRewards(
            raw=list(rewards),
            mean=mean,
            std=std,
            normalized=normalized,
        )

    # ------------------------------------------------------------------
    # Baseline subtraction
    # ------------------------------------------------------------------

    def score_with_baseline(self, rewards: List[float],
                            baseline: float) -> List[float]:
        """
        Subtract a moving baseline from rewards.

        This is useful for online settings where the baseline is maintained
        as a running average across episodes. The result is:
            adjusted_i = r_i - baseline

        Args:
            rewards: List of raw reward values.
            baseline: The baseline value to subtract (e.g., EMA of past rewards).

        Returns:
            List of baseline-adjusted rewards.
        """
        return [r - baseline for r in rewards]

    # ------------------------------------------------------------------
    # Exponential moving average
    # ------------------------------------------------------------------

    def exponential_moving_average(self, rewards: List[float],
                                   alpha: float = 0.1) -> List[float]:
        """
        Compute exponential moving average (EMA) over a reward sequence.

        EMA provides a smooth baseline estimate that adapts to non-stationary
        reward distributions. The recursion is:
            ema_0 = rewards[0]
            ema_t = alpha * rewards_t + (1 - alpha) * ema_{t-1}

        Lower alpha means slower adaptation (more smoothing).

        Args:
            rewards: Sequence of reward values (ordered chronologically).
            alpha: Smoothing factor in (0, 1]. Lower = more smoothing.

        Returns:
            List of EMA values with same length as input.
        """
        if not rewards:
            return []

        alpha = max(1e-8, min(1.0, alpha))  # Clamp to valid range
        ema_values: List[float] = []
        ema = rewards[0]
        ema_values.append(ema)

        for r in rewards[1:]:
            ema = alpha * r + (1.0 - alpha) * ema
            ema_values.append(ema)

        return ema_values

    # ------------------------------------------------------------------
    # Rank normalization
    # ------------------------------------------------------------------

    def rank_normalize(self, rewards: List[float]) -> List[float]:
        """
        Convert rewards to rank-based scores in [0, 1].

        Rank normalization is a non-parametric method that maps rewards to
        their relative position in the sorted order:
            rank_score_i = (rank_i - 1) / (N - 1)

        where rank_i is the 1-based position in the sorted ascending order.
        Ties are resolved by averaging the ranks of tied elements.

        For a single element, returns [0.5].

        Args:
            rewards: List of raw reward values.

        Returns:
            List of rank-normalized scores in [0, 1].
        """
        n = len(rewards)
        if n == 0:
            return []
        if n == 1:
            return [0.5]

        # Compute ranks with tie-breaking (average rank for ties)
        # Sort indices by value
        indexed = sorted(enumerate(rewards), key=lambda x: x[1])

        # Assign ranks, averaging ties
        ranks = [0.0] * n
        i = 0
        while i < n:
            j = i
            # Find the end of the tied group
            while j < n - 1 and indexed[j][1] == indexed[j + 1][1]:
                j += 1
            # Average rank for tied group (1-based)
            avg_rank = (i + j) / 2.0 + 1.0  # +1 for 1-based
            for k in range(i, j + 1):
                original_idx = indexed[k][0]
                ranks[original_idx] = avg_rank
            i = j + 1

        # Normalize to [0, 1]
        return [(r - 1.0) / (n - 1.0) for r in ranks]

    # ------------------------------------------------------------------
    # Multi-signal reward combination
    # ------------------------------------------------------------------

    def combine_rewards(
        self,
        task_reward: float,
        format_reward: float,
        safety_reward: float,
        weights: Tuple[float, float, float] = (0.6, 0.2, 0.2),
    ) -> float:
        """
        Combine task, format, and safety rewards into a single scalar.

        The combined reward is a weighted sum:
            R = w_task * r_task + w_format * r_format + w_safety * r_safety

        The weights should sum to 1.0 for a proper weighted average, but
        this is not strictly enforced to allow flexible scaling.

        Args:
            task_reward: Reward for task correctness [0, 1].
            format_reward: Reward for output format compliance [0, 1].
            safety_reward: Reward for safety compliance [0, 1].
            weights: Tuple of (task_weight, format_weight, safety_weight).
                     Default: (0.6, 0.2, 0.2).

        Returns:
            Combined reward value.
        """
        w_task, w_format, w_safety = weights
        return w_task * task_reward + w_format * format_reward + w_safety * safety_reward
