"""
QAG-MemBrain Layer 4: Loss Normalization with Length Bias Correction
=====================================================================
Implements per-token loss normalization and length bias correction for
the GRPO/DAPO training loop.

The Problem:
    In autoregressive models, longer sequences produce more tokens and
    therefore more loss terms. Without correction, the total loss is
    dominated by long sequences, creating a length bias that encourages
    the model to generate shorter outputs.

The Solution:
    1. Per-token normalization: Divide each token's loss by the number
       of tokens in its sequence, so each sequence contributes equally
       regardless of length.
    2. Length bias correction: Subtract a penalty proportional to
       sequence length to counteract any residual length-dependent
       effects:
           penalty_i = lambda_lb * len_i / max_len
    3. Effective token count: When computing the mean loss, use an
       adjusted token count that accounts for the bias correction.

Reference:
    This approach follows the length normalization strategy described in
    "DAPO: An Open-Source LLM Reinforcement Learning System" (Yu et al., 2025)
    and the per-token loss computation in "DeepSeek-R1" (DeepSeek-AI, 2025).
"""

import math
from typing import List


class LossNormalization:
    """
    Per-token loss normalization with length bias correction.

    Ensures that sequences of different lengths contribute proportionally
    to the overall loss, preventing length bias in policy optimization.
    """

    def __init__(self, lambda_lb: float = 0.01):
        """
        Args:
            lambda_lb: Length bias penalty coefficient. Higher values
                       apply stronger correction for length imbalance.
        """
        self.lambda_lb = lambda_lb

    # ------------------------------------------------------------------
    # Per-token normalization
    # ------------------------------------------------------------------

    def per_token_normalize(self, token_losses: List[float]) -> List[float]:
        """
        Normalize token losses by sequence length.

        Each token loss is divided by the total number of tokens in the
        sequence, so the sum of normalized losses equals the mean loss:
            normalized_i = loss_i / N

        where N = len(token_losses).

        Args:
            token_losses: Per-token losses for a single sequence.

        Returns:
            Length-normalized per-token losses.
        """
        n = len(token_losses)
        if n == 0:
            return []
        return [l / n for l in token_losses]

    # ------------------------------------------------------------------
    # Length bias correction
    # ------------------------------------------------------------------

    def length_bias_correct(self, token_losses: List[float],
                            sequence_lengths: List[int],
                            lambda_lb: float = 0.0) -> List[float]:
        """
        Apply length bias correction to per-token losses.

        For each sequence, a penalty proportional to its relative length
        is subtracted from the normalized loss:
            corrected_i = normalized_loss_i - lambda_lb * len_i / max_len

        This counteracts the residual tendency for longer sequences to
        contribute more to the total loss even after per-token normalization.

        Args:
            token_losses: Per-token losses (one per sequence, already
                          aggregated per sequence, e.g., mean per sequence).
            sequence_lengths: Length of each sequence.
            lambda_lb: Length bias penalty coefficient. Uses instance
                       default if 0.

        Returns:
            Length-bias-corrected losses, one per sequence.
        """
        lb = lambda_lb if lambda_lb > 0 else self.lambda_lb

        n = len(token_losses)
        if n == 0:
            return []

        if len(sequence_lengths) != n:
            raise ValueError(
                f"token_losses length ({n}) != "
                f"sequence_lengths length ({len(sequence_lengths)})"
            )

        max_len = max(sequence_lengths) if sequence_lengths else 1
        if max_len == 0:
            return list(token_losses)

        corrected: List[float] = []
        for loss, seq_len in zip(token_losses, sequence_lengths):
            penalty = lb * seq_len / max_len
            corrected.append(loss - penalty)

        return corrected

    # ------------------------------------------------------------------
    # Full sequence loss computation
    # ------------------------------------------------------------------

    def compute_sequence_loss(self, token_losses: List[List[float]],
                              sequence_lengths: List[int],
                              lambda_lb: float = 0.0) -> float:
        """
        Compute the aggregate loss across multiple sequences.

        Steps:
            1. Compute mean loss per sequence (per-token normalization).
            2. Apply length bias correction.
            3. Average across sequences using effective token count.

        Args:
            token_losses: List of per-token loss lists, one per sequence.
            sequence_lengths: Length of each sequence.
            lambda_lb: Length bias penalty coefficient. Uses instance
                       default if 0.

        Returns:
            Scalar aggregate loss.
        """
        n_seqs = len(token_losses)
        if n_seqs == 0:
            return 0.0

        if len(sequence_lengths) != n_seqs:
            raise ValueError(
                f"token_losses count ({n_seqs}) != "
                f"sequence_lengths count ({len(sequence_lengths)})"
            )

        # Step 1: Per-token normalize each sequence
        per_seq_means: List[float] = []
        for seq_losses in token_losses:
            if len(seq_losses) == 0:
                per_seq_means.append(0.0)
            else:
                per_seq_means.append(sum(seq_losses) / len(seq_losses))

        # Step 2: Length bias correction
        corrected = self.length_bias_correct(
            per_seq_means, sequence_lengths, lambda_lb
        )

        # Step 3: Aggregate using effective token count
        eff_count = self.effective_token_count(sequence_lengths, lambda_lb)

        total_loss = sum(
            corr * seq_len
            for corr, seq_len in zip(corrected, sequence_lengths)
        )

        if eff_count < 1e-12:
            return sum(corrected) / n_seqs

        return total_loss / eff_count

    # ------------------------------------------------------------------
    # Effective token count
    # ------------------------------------------------------------------

    def effective_token_count(self, sequence_lengths: List[int],
                              lambda_lb: float = 0.0) -> float:
        """
        Compute the effective token count for loss normalization.

        Adjusts the raw token count by subtracting the length bias:
            effective = sum(len_i - lambda_lb * len_i^2 / max_len)

        This ensures that the normalization denominator accounts for the
        bias correction applied to the numerator.

        Args:
            sequence_lengths: Length of each sequence.
            lambda_lb: Length bias penalty coefficient. Uses instance
                       default if 0.

        Returns:
            Effective token count (float, may be less than raw total).
        """
        lb = lambda_lb if lambda_lb > 0 else self.lambda_lb

        if not sequence_lengths:
            return 0.0

        max_len = max(sequence_lengths)
        if max_len == 0:
            return 0.0

        effective = 0.0
        for seq_len in sequence_lengths:
            # Raw contribution minus length-dependent penalty
            effective += seq_len - lb * (seq_len ** 2) / max_len

        # Ensure effective count is positive
        return max(effective, 1.0)
