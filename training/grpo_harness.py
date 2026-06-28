"""
QAG_MemBrain — GRPO Training Harness
=====================================
Group Relative Policy Optimization for the AtomMem CRUD policy.

The model learns WHEN to emit each action token:
  <create_memory>  <read_memory>  <update_memory>  <delete_memory>

Reward signals:
  1. Exact Match (EM)   — did the action match the gold label?
  2. Memory Efficiency  — did the model DELETE redundant atoms?
  3. Context Precision  — did recall actually improve the answer?
  4. LLM-as-Judge       — Mellum2 scores relevance of retrieved memory

Griptape Workflow DAGs formalize the "Rollout Phase":
  Every step of the agent's memory manipulation trajectory is
  recorded for unified credit assignment (GRPO group rollouts).

Training does NOT happen here at inference time.
This harness generates training episodes from production runs,
then outputs JSONL training data for offline GRPO fine-tuning.
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any
import json, os, re, time, uuid


# ─── Reward functions ────────────────────────────────────────────────

def reward_exact_match(predicted_action: str, gold_action: str) -> float:
    """Binary reward: did the model choose the right CRUD action?"""
    return 1.0 if predicted_action.strip() == gold_action.strip() else 0.0


def reward_memory_efficiency(
    actions_taken:   list[str],
    atoms_before:    int,
    atoms_after:     int,
) -> float:
    """
    Reward for keeping memory lean.
    Penalizes unnecessary creates. Rewards targeted deletes.
    """
    creates = actions_taken.count("create_memory")
    deletes = actions_taken.count("delete_memory")
    net_growth = atoms_after - atoms_before

    if net_growth > 5:    return -0.2    # bloat penalty
    if deletes > 0:       return 0.3     # pruning bonus
    if creates == 0:      return 0.1     # no-op when not needed
    return 0.0


def reward_context_precision(
    query:            str,
    retrieved_atoms:  list[dict],
    final_answer:     str,
) -> float:
    """
    Reward: did retrieved memories actually help the answer?
    Heuristic: atom content overlap with final answer.
    In production: replace with LLM-as-judge call.
    """
    if not retrieved_atoms:
        return 0.0
    query_words  = set(query.lower().split())
    answer_words = set(final_answer.lower().split())
    relevant     = 0
    for atom in retrieved_atoms:
        atom_words = set(atom.get("content", "").lower().split())
        if atom_words & query_words & answer_words:
            relevant += 1
    return min(1.0, relevant / max(1, len(retrieved_atoms)))


async def reward_llm_judge(
    query:       str,
    action_log:  list[dict],
    final_answer: str,
    mellum2_endpoint: str,
) -> float:
    """
    LLM-as-judge: Mellum2 scores the quality of memory management.
    Returns 0.0–1.0.
    """
    import aiohttp
    prompt = (
        "Score this AI memory management episode on a scale of 0.0 to 1.0.\n"
        f"Query: {query[:200]}\n"
        f"Actions taken: {json.dumps([a['action'] for a in action_log])}\n"
        f"Final answer: {final_answer[:300]}\n\n"
        "Criteria: Did the agent retrieve relevant memories? "
        "Did it avoid storing redundant data? Did it clean up stale entries?\n"
        'Respond ONLY with JSON: {"score": <float 0.0-1.0>, "reason": "<one sentence>"}'
    )
    try:
        async with aiohttp.ClientSession() as s:
            async with s.post(mellum2_endpoint, json={
                "model": "mellum2", "prompt": prompt,
                "stream": False, "format": "json"
            }, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                data = await resp.json()
                result = json.loads(data["response"])
                return float(result.get("score", 0.0))
    except Exception:
        return 0.0


# ─── Episode recorder ─────────────────────────────────────────────────

@dataclass
class TrainingEpisode:
    """One GRPO rollout episode — recorded during inference, used for training."""
    episode_id:     str = field(default_factory=lambda: str(uuid.uuid4()))
    query:          str = ""
    action_log:     list[dict] = field(default_factory=list)  # [{action, atom_id, content}]
    retrieved_atoms: list[dict] = field(default_factory=list)
    final_answer:   str = ""
    rewards:        dict[str, float] = field(default_factory=dict)
    total_reward:   float = 0.0
    timestamp:      int = field(default_factory=lambda: int(time.time() * 1000))

    def log_action(self, action: str, atom_id: str = "", content: str = "") -> None:
        self.action_log.append({
            "action":   action,
            "atom_id":  atom_id,
            "content":  content[:200],
            "ts":       int(time.time() * 1000),
        })

    def to_training_jsonl(self) -> str:
        """Serialize as JSONL training record for offline GRPO fine-tuning."""
        return json.dumps({
            "episode_id":      self.episode_id,
            "query":           self.query,
            "action_sequence": [a["action"] for a in self.action_log],
            "total_reward":    self.total_reward,
            "rewards":         self.rewards,
            "timestamp":       self.timestamp,
        })


# ─── GRPO training harness ────────────────────────────────────────────

class GRPOHarness:
    """
    Records inference episodes → computes rewards → writes JSONL training data.
    Offline consumption: feed to GRPO fine-tuning run on Mellum2/Gemma.

    Group Rollouts: N episodes for the same query → rank by total_reward
    → compute relative advantages → gradient update.
    """

    def __init__(
        self,
        training_output_path: str,
        mellum2_endpoint: str | None = None,
    ):
        self.output_path    = training_output_path
        self.mellum2_endpoint = mellum2_endpoint or os.environ.get(
            "MELLUM2_ENDPOINT", "http://localhost:11434/api/generate"
        )
        self.episodes: list[TrainingEpisode] = []

    def start_episode(self, query: str) -> TrainingEpisode:
        ep = TrainingEpisode(query=query)
        self.episodes.append(ep)
        return ep

    async def score_and_finalize(
        self,
        episode:       TrainingEpisode,
        atoms_before:  int,
        atoms_after:   int,
        gold_action:   str | None = None,
    ) -> TrainingEpisode:
        """Compute all reward signals and finalize the episode."""
        rewards: dict[str, float] = {}

        # Exact match (if gold label available)
        if gold_action and episode.action_log:
            last = episode.action_log[-1]["action"]
            rewards["exact_match"] = reward_exact_match(last, gold_action)

        # Memory efficiency
        rewards["efficiency"] = reward_memory_efficiency(
            [a["action"] for a in episode.action_log],
            atoms_before, atoms_after,
        )

        # Context precision
        rewards["precision"] = reward_context_precision(
            episode.query, episode.retrieved_atoms, episode.final_answer
        )

        # LLM judge (async, non-blocking)
        rewards["llm_judge"] = await reward_llm_judge(
            episode.query, episode.action_log,
            episode.final_answer, self.mellum2_endpoint
        )

        # Weighted total (tunable)
        episode.rewards      = rewards
        episode.total_reward = (
            rewards.get("exact_match", 0) * 0.35 +
            rewards.get("efficiency",   0) * 0.25 +
            rewards.get("precision",    0) * 0.20 +
            rewards.get("llm_judge",    0) * 0.20
        )

        # Write to training JSONL
        with open(self.output_path, "a") as f:
            f.write(episode.to_training_jsonl() + "\n")

        return episode

    def group_rollouts(self, query: str) -> list[TrainingEpisode]:
        """Return all episodes for a given query (GRPO group)."""
        return [ep for ep in self.episodes if ep.query == query]

    def compute_advantages(self, episodes: list[TrainingEpisode]) -> list[float]:
        """
        GRPO advantage = (reward - mean_reward) / std_reward
        Positive advantage = above-average episode → reinforce.
        Negative advantage = below-average episode → suppress.
        """
        if not episodes:
            return []
        rewards = [ep.total_reward for ep in episodes]
        mean = sum(rewards) / len(rewards)
        std  = (sum((r - mean)**2 for r in rewards) / len(rewards)) ** 0.5
        if std == 0:
            return [0.0] * len(episodes)
        return [(r - mean) / std for r in rewards]

    def export_grpo_batch(self, query: str) -> list[dict]:
        """
        Export a GRPO training batch for a given query.
        Format: list of {episode_id, action_sequence, advantage}
        Feed directly to your fine-tuning script.
        """
        eps        = self.group_rollouts(query)
        advantages = self.compute_advantages(eps)
        return [
            {
                "episode_id":      ep.episode_id,
                "query":           ep.query,
                "action_sequence": [a["action"] for a in ep.action_log],
                "total_reward":    ep.total_reward,
                "advantage":       adv,
            }
            for ep, adv in zip(eps, advantages)
        ]
