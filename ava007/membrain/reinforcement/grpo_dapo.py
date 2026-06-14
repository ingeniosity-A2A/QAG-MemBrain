"""
QAG-MemBrain Layer 4: GRPO/DAPO Reinforcement Learning
=======================================================
Core implementation of Group Relative Policy Optimization (GRPO) and
Distribution-Augmented Policy Optimization (DAPO).

GRPO eliminates the need for a separate value function by computing advantages
relative to group statistics. For a group of G samples from the same prompt:
    advantage_i = (reward_i - mean(rewards)) / std(rewards)

DAPO extends GRPO by introducing a distribution-augmented reference policy,
which adds controlled noise to prevent mode collapse and encourage exploration.
The KL penalty is computed against the augmented distribution rather than the
original reference, providing a softer constraint that allows broader search.

References:
    - GRPO: "DeepSeek-R1: Incentivizing Reasoning Capability in LLMs via
      Reinforcement Learning" (DeepSeek-AI, 2025)
    - DAPO: "DAPO: An Open-Source LLM Reinforcement Learning System"
      (Yu et al., 2025)
"""

import math
from typing import List, Optional, Tuple
from dataclasses import dataclass, field


@dataclass
class OptimizationResult:
    """Result of a single GRPO/DAPO optimization step."""
    loss: float
    advantages: List[float]
    clipped_mask: List[bool]
    kl_penalty: float
    entropy: float


class GRPODAPO:
    """
    Combined GRPO + DAPO policy optimization algorithm.

    GRPO replaces the learned value function with group-level baseline
    normalization. DAPO augments the reference policy with noise to prevent
    mode collapse during optimization.

    Usage:
        optimizer = GRPODAPO()
        result = optimizer.optimize_step(
            rewards=[1.0, 0.5, 0.8, 0.2],
            log_probs=[-0.1, -0.3, -0.2, -0.5],
            ref_log_probs=[-0.2, -0.25, -0.22, -0.45],
            clip_epsilon=0.2,
            beta=0.01,
        )
    """

    def __init__(self, epsilon_low: float = 0.2, epsilon_high: float = 0.3,
                 beta: float = 0.01, group_size: int = 4):
        """
        Args:
            epsilon_low: Lower clipping bound (conservative side).
            epsilon_high: Upper clipping bound (exploration side).
            beta: Default KL penalty coefficient for DAPO.
            group_size: Default group size for advantage computation.
        """
        self.epsilon_low = epsilon_low
        self.epsilon_high = epsilon_high
        self.beta = beta
        self.group_size = group_size

    # ------------------------------------------------------------------
    # GRPO Core
    # ------------------------------------------------------------------

    def compute_advantages(self, rewards: List[float],
                           group_size: int = 0) -> List[float]:
        """
        Compute group-normalized advantages.

        For each sample in a group, the advantage is:
            A_i = (r_i - mu_G) / sigma_G

        where mu_G and sigma_G are the mean and population standard deviation
        of rewards within the group. If all rewards are identical (sigma=0),
        advantages are set to 0.0 to avoid division by zero.

        Args:
            rewards: Flat list of rewards (length should be a multiple of
                     group_size).
            group_size: Number of samples per group. Uses default if 0.

        Returns:
            List of advantages with same length as rewards.
        """
        gs = group_size if group_size > 0 else self.group_size
        n = len(rewards)
        if n == 0:
            return []

        advantages: List[float] = []
        # Process in groups
        for start in range(0, n, gs):
            group = rewards[start:start + gs]
            g_len = len(group)
            if g_len == 0:
                continue
            mean_g = sum(group) / g_len
            # Population standard deviation
            var_g = sum((r - mean_g) ** 2 for r in group) / g_len
            std_g = math.sqrt(var_g)

            for r in group:
                if std_g < 1e-12:
                    advantages.append(0.0)
                else:
                    advantages.append((r - mean_g) / std_g)

        return advantages

    def compute_ratio(self, log_probs: List[float],
                      ref_log_probs: List[float]) -> List[float]:
        """
        Compute importance sampling ratio r(theta) = pi_theta / pi_ref.

        Given log-probabilities under the current and reference policies:
            ratio_i = exp(log_prob_i - ref_log_prob_i)

        This ratio measures how much more (or less) likely the current
        policy considers each action compared to the reference.

        Args:
            log_probs: Log-probabilities under current policy.
            ref_log_probs: Log-probabilities under reference policy.

        Returns:
            List of importance sampling ratios.

        Raises:
            ValueError: If input lengths differ.
        """
        if len(log_probs) != len(ref_log_probs):
            raise ValueError(
                f"log_probs length ({len(log_probs)}) != "
                f"ref_log_probs length ({len(ref_log_probs)})"
            )
        return [math.exp(lp - rlp) for lp, rlp in zip(log_probs, ref_log_probs)]

    def compute_grpo_loss(self, advantages: List[float],
                          ratios: List[float],
                          clip_epsilon: float = 0.2) -> List[float]:
        """
        Compute clipped surrogate loss (GRPO variant).

        For each sample:
            L_i = -min(r_i * A_i, clip(r_i, 1-eps, 1+eps) * A_i)

        The loss is the negative of the clipped objective, since we minimize.
        When advantage > 0, we clip the upper bound of the ratio to prevent
        overly large updates. When advantage < 0, we clip the lower bound.

        Args:
            advantages: Group-normalized advantages.
            ratios: Importance sampling ratios.
            clip_epsilon: Clipping parameter (symmetric in base GRPO).

        Returns:
            List of per-sample losses (positive values to minimize).
        """
        if len(advantages) != len(ratios):
            raise ValueError(
                f"advantages length ({len(advantages)}) != "
                f"ratios length ({len(ratios)})"
            )
        losses: List[float] = []
        for a, r in zip(advantages, ratios):
            clipped_r = max(1.0 - clip_epsilon, min(1.0 + clip_epsilon, r))
            # Objective: min(r*A, clip(r)*A); Loss = -objective
            obj_unclipped = r * a
            obj_clipped = clipped_r * a
            losses.append(-min(obj_unclipped, obj_clipped))
        return losses

    # ------------------------------------------------------------------
    # DAPO Extension
    # ------------------------------------------------------------------

    def compute_dapo_penalty(self, log_probs: List[float],
                             augmented_log_probs: List[float],
                             beta: float = 0.0) -> List[float]:
        """
        Compute KL divergence penalty against the augmented reference.

        DAPO augments the reference policy with noise, creating a broader
        distribution. The KL penalty against this augmented reference is:
            KL_i = augmented_log_prob_i - log_prob_i

        This is the per-sample KL divergence approximation (leaving out
        constants that don't affect gradients).

        Args:
            log_probs: Log-probabilities under current policy.
            augmented_log_probs: Log-probabilities under augmented reference.
            beta: KL penalty coefficient. Uses default if 0.

        Returns:
            List of per-sample KL penalties (non-negative when beta > 0).
        """
        b = beta if beta > 0 else self.beta
        if len(log_probs) != len(augmented_log_probs):
            raise ValueError(
                f"log_probs length ({len(log_probs)}) != "
                f"augmented_log_probs length ({len(augmented_log_probs)})"
            )
        penalties: List[float] = []
        for lp, alp in zip(log_probs, augmented_log_probs):
            # KL(q||p) ≈ log(q/p) * q, but per-sample approximation:
            # penalty = beta * (augmented_lp - lp) = beta * log(pi_aug/pi)
            # This is the reverse KL: encourage pi to stay close to pi_aug
            kl_approx = alp - lp
            penalties.append(b * kl_approx)
        return penalties

    # ------------------------------------------------------------------
    # Entropy computation
    # ------------------------------------------------------------------

    def compute_entropy(self, log_probs: List[float]) -> float:
        """
        Approximate entropy from log-probabilities.

        For a discrete distribution: H = -sum(p * log(p))
        Given log_probs = log(p_i), we have:
            H = -sum(exp(log_prob_i) * log_prob_i)

        This approximation assumes log_probs represent the log of action
        probabilities under the current policy.

        Args:
            log_probs: Log-probabilities of taken actions.

        Returns:
            Approximate entropy (non-negative).
        """
        if not log_probs:
            return 0.0
        entropy = 0.0
        for lp in log_probs:
            p = math.exp(lp)
            if p > 1e-15:
                entropy -= p * lp
        return entropy

    # ------------------------------------------------------------------
    # Full optimization step
    # ------------------------------------------------------------------

    def optimize_step(
        self,
        rewards: List[float],
        log_probs: List[float],
        ref_log_probs: List[float],
        augmented_log_probs: Optional[List[float]] = None,
        clip_epsilon: float = 0.0,
        beta: float = 0.0,
    ) -> OptimizationResult:
        """
        Execute a full GRPO/DAPO optimization step.

        Combines advantage computation, ratio computation, clipped surrogate
        loss, and optional DAPO KL penalty into a single unified step.

        Args:
            rewards: Per-sample rewards.
            log_probs: Log-probabilities under current policy.
            ref_log_probs: Log-probabilities under reference policy.
            augmented_log_probs: Optional log-probs under augmented reference
                                 (enables DAPO when provided).
            clip_epsilon: Clipping parameter. Uses default if 0.
            beta: KL penalty coefficient. Uses default if 0.

        Returns:
            OptimizationResult containing loss, advantages, clipping info,
            KL penalty, and entropy.
        """
        eps = clip_epsilon if clip_epsilon > 0 else self.epsilon_low
        b = beta if beta > 0 else self.beta

        # 1. Compute group-normalized advantages
        advantages = self.compute_advantages(rewards)

        # 2. Compute importance sampling ratios
        ratios = self.compute_ratio(log_probs, ref_log_probs)

        # 3. Compute clipped surrogate loss
        per_sample_losses = self.compute_grpo_loss(advantages, ratios, eps)

        # 4. Determine clipping mask
        clipped_mask: List[bool] = []
        for r in ratios:
            is_clipped = r < (1.0 - eps) or r > (1.0 + eps)
            clipped_mask.append(is_clipped)

        # 5. Compute DAPO KL penalty if augmented log probs provided
        total_kl_penalty = 0.0
        if augmented_log_probs is not None:
            kl_penalties = self.compute_dapo_penalty(
                log_probs, augmented_log_probs, b
            )
            total_kl_penalty = sum(kl_penalties) / max(len(kl_penalties), 1)

            # Add KL penalty to per-sample losses
            per_sample_losses = [
                l + kp for l, kp in zip(per_sample_losses, kl_penalties)
            ]

        # 6. Aggregate loss (mean over samples)
        total_loss = (
            sum(per_sample_losses) / max(len(per_sample_losses), 1)
        )

        # 7. Compute entropy
        entropy = self.compute_entropy(log_probs)

        return OptimizationResult(
            loss=total_loss,
            advantages=advantages,
            clipped_mask=clipped_mask,
            kl_penalty=total_kl_penalty,
            entropy=entropy,
        )
