"""
makeMoE + turbovec Hybrid Router Sketch
---------------------------------------
Combines the classic Top-k / noisy Top-k gating from makeMoE
with semantic nearest-neighbor routing supplied by turbovec.

This is a structural reference, not a full training loop.
"""

from __future__ import annotations
from typing import Optional

import torch
import torch.nn as nn
import torch.nn.functional as F
import numpy as np

# turbovec is used at the coordination / expert-selection stage
# (outside the pure torch forward for clarity in this sketch)


class Expert(nn.Module):
    """Simple MLP expert (makeMoE style)."""

    def __init__(self, n_embd: int, dropout: float = 0.1):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(n_embd, 4 * n_embd),
            nn.ReLU(),
            nn.Linear(4 * n_embd, n_embd),
            nn.Dropout(dropout),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


class TopkRouter(nn.Module):
    """Classic makeMoE Top-k router."""

    def __init__(self, n_embd: int, num_experts: int, top_k: int = 2):
        super().__init__()
        self.top_k = top_k
        self.linear = nn.Linear(n_embd, num_experts)

    def forward(self, x: torch.Tensor):
        logits = self.linear(x)                     # (B, T, E)
        top_k_logits, indices = logits.topk(self.top_k, dim=-1)
        zeros = torch.full_like(logits, float("-inf"))
        sparse = zeros.scatter(-1, indices, top_k_logits)
        gates = F.softmax(sparse, dim=-1)
        return gates, indices


class NoisyTopkRouter(TopkRouter):
    """Noisy Top-k for load balancing (makeMoE)."""

    def __init__(self, n_embd: int, num_experts: int, top_k: int = 2):
        super().__init__(n_embd, num_experts, top_k)
        self.noise = nn.Linear(n_embd, num_experts)

    def forward(self, x: torch.Tensor):
        logits = self.linear(x)
        noise = torch.randn_like(logits) * F.softplus(self.noise(x))
        noisy_logits = logits + noise
        top_k_logits, indices = noisy_logits.topk(self.top_k, dim=-1)
        zeros = torch.full_like(noisy_logits, float("-inf"))
        sparse = zeros.scatter(-1, indices, top_k_logits)
        gates = F.softmax(sparse, dim=-1)
        return gates, indices


class HybridMoEBlock(nn.Module):
    """
    Hybrid block:
    1. Optional turbovec semantic pre-filter (outside torch, called by coordinator)
    2. makeMoE-style Top-k / noisy Top-k gating over the surviving experts
    """

    def __init__(
        self,
        n_embd: int,
        num_experts: int,
        top_k: int = 2,
        noisy: bool = True,
        dropout: float = 0.1,
    ):
        super().__init__()
        self.experts = nn.ModuleList([Expert(n_embd, dropout) for _ in range(num_experts)])
        self.router = NoisyTopkRouter(n_embd, num_experts, top_k) if noisy else TopkRouter(n_embd, num_experts, top_k)
        self.top_k = top_k

    def forward(self, x: torch.Tensor, expert_mask: Optional[torch.Tensor] = None):
        """
        x: (B, T, C)
        expert_mask: optional (E,) bool tensor – only route to these experts
                     (produced upstream by turbovec nearest-neighbor filter)
        """
        gates, indices = self.router(x)             # (B, T, E), (B, T, K)

        if expert_mask is not None:
            # Zero out gates for experts not selected by turbovec
            mask = expert_mask.to(gates.device).view(1, 1, -1)
            gates = gates * mask
            gates = gates / (gates.sum(dim=-1, keepdim=True) + 1e-9)

        # Dispatch (simplified – real code uses einsum or scatter)
        out = torch.zeros_like(x)
        for k in range(self.top_k):
            expert_idx = indices[..., k]            # (B, T)
            gate = gates.gather(-1, expert_idx.unsqueeze(-1)).squeeze(-1)
            # For clarity we loop; production uses vectorized expert parallel
            for e in range(len(self.experts)):
                mask = (expert_idx == e)
                if mask.any():
                    selected = x[mask]
                    expert_out = self.experts[e](selected)
                    out[mask] += gate[mask].unsqueeze(-1) * expert_out
        return out


# ---------------------------------------------------------------------------
# Coordinator helper (calls turbovec then builds expert_mask)
# ---------------------------------------------------------------------------
def build_expert_mask_from_turbovec(
    query_embedding: np.ndarray,
    expert_embeddings: np.ndarray,
    index,                          # turbovec.IdMapIndex or TurboQuantIndex
    k: int = 4,
    threshold: float = 0.75,
) -> np.ndarray:
    """
    Return a boolean mask over experts that are semantically close to the query.
    Used to restrict the makeMoE router to a high-signal subset.
    """
    scores, ids = index.search(query_embedding[None, :], k=k)
    mask = np.zeros(len(expert_embeddings), dtype=bool)
    for score, eid in zip(scores[0], ids[0]):
        if score >= threshold and 0 <= eid < len(mask):
            mask[eid] = True
    if not mask.any():               # fallback: allow all
        mask[:] = True
    return mask


if __name__ == "__main__":
    # Smoke test
    B, T, C, E = 2, 8, 64, 4
    block = HybridMoEBlock(n_embd=C, num_experts=E, top_k=2, noisy=True)
    x = torch.randn(B, T, C)
    y = block(x)
    print("HybridMoEBlock output shape:", y.shape)
