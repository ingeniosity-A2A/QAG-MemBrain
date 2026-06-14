"""
QAG-MemBrain Layer 4: GRPO/DAPO Reinforcement Learning
========================================================
The reinforcement layer implements policy optimization for the Ava007
cognitive runtime using Group Relative Policy Optimization (GRPO) and
Distribution-Augmented Policy Optimization (DAPO).

Modules:
    grpo_dapo          — Core GRPO/DAPO algorithm and optimization step
    reward_scoring     — Group-normalized reward scoring and combination
    clipping           — Asymmetric epsilon clipping for ratio constraints
    loss_normalization — Per-token loss normalization with length bias fix
    rlvr               — Verifiable reward functions (RLVR)

Key Classes:
    GRPODAPO           — Combined GRPO + DAPO policy optimizer
    RewardScorer       — Reward normalization and multi-signal combination
    NormalizedRewards  — Dataclass for group-normalized reward statistics
    AsymmetricClipping — Asymmetric ratio clipping with adaptive bounds
    LossNormalization  — Per-token normalization with length bias correction
    RLVR               — Deterministic, verifiable reward functions
    OptimizationResult — Dataclass for optimization step output
"""

from .grpo_dapo import GRPODAPO, OptimizationResult
from .reward_scoring import RewardScorer, NormalizedRewards
from .clipping import AsymmetricClipping
from .loss_normalization import LossNormalization
from .rlvr import RLVR

__all__ = [
    "GRPODAPO",
    "OptimizationResult",
    "RewardScorer",
    "NormalizedRewards",
    "AsymmetricClipping",
    "LossNormalization",
    "RLVR",
]
