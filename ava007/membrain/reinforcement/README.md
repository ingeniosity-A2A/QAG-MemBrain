# QAG-MemBrain Layer 4: GRPO/DAPO Reinforcement Learning

## Overview

Layer 4 implements policy optimization for the Ava007 cognitive runtime using **Group Relative Policy Optimization (GRPO)** and **Distribution-Augmented Policy Optimization (DAPO)**. This layer trains the decision policies that govern memory retrieval, task routing, and response generation by optimizing against verifiable reward signals.

## Architecture

```
reinforcement/
├── __init__.py            # Package exports
├── grpo_dapo.py           # Core GRPO/DAPO algorithm
├── reward_scoring.py      # Group-normalized reward scoring
├── clipping.py            # Asymmetric epsilon clipping
├── loss_normalization.py  # Per-token + length bias correction
├── rlvr.py                # Verifiable reward functions (RLVR)
└── README.md              # This file
```

## Key Concepts

### GRPO (Group Relative Policy Optimization)

GRPO eliminates the need for a separate value function (critic) by computing advantages relative to group statistics:

```
advantage_i = (reward_i - group_mean) / group_std
```

For each prompt, a group of G completions is sampled. The group mean serves as the baseline, and the group standard deviation normalizes the advantage scale. This removes the computational overhead of maintaining a value network while producing stable advantage estimates.

### DAPO (Distribution-Augmented Policy Optimization)

DAPO extends GRPO by augmenting the reference policy with controlled noise:

```
KL_penalty = beta * (log_pi_augmented - log_pi_current)
```

The augmented reference is a broadened version of the original reference policy. By computing the KL penalty against this augmented distribution instead of the original, DAPO provides a softer constraint that:
- Prevents mode collapse during optimization
- Encourages broader exploration of the action space
- Allows the policy to deviate further from the reference without penalty

### Asymmetric Clipping

Standard PPO clips the importance sampling ratio symmetrically to `[1-ε, 1+ε]`. GRPO benefits from asymmetric clipping where `ε_high > ε_low`, allowing more exploration in the direction of positive advantage:

```
clip(ratio, 1-ε_low, 1+ε_high)
```

Default: `ε_low=0.2, ε_high=0.3` — ratios can grow to 1.3 for positive-advantage actions but only shrink to 0.8 for negative-advantage actions.

### Length Bias Correction

In autoregressive models, longer sequences contribute more loss terms. Without correction, the optimizer is biased toward shorter outputs. The correction applies:

1. **Per-token normalization**: Divide each token loss by sequence length
2. **Length penalty**: Subtract `λ × len_i / max_len` from each sequence's mean loss
3. **Effective token count**: Adjust the normalization denominator to account for the penalty

### RLVR (Reinforcement Learning with Verifiable Rewards)

Verifiable rewards are deterministic, bounded functions that can be independently checked:

| Reward Type | Domain | Method |
|-------------|--------|--------|
| Exact match | Text | String equality |
| F1 score | Text | Token-level F1 |
| JSON schema | Structured output | Key/type validation |
| Code execution | Code | Sandboxed test runner |
| Math equivalence | Mathematics | Numeric substitution |

## Module Reference

### `grpo_dapo.GRPODAPO`

Core optimizer combining GRPO and DAPO.

```python
optimizer = GRPODAPO(epsilon_low=0.2, epsilon_high=0.3, beta=0.01)
result = optimizer.optimize_step(
    rewards=[1.0, 0.5, 0.8, 0.2],
    log_probs=[-0.1, -0.3, -0.2, -0.5],
    ref_log_probs=[-0.2, -0.25, -0.22, -0.45],
    augmented_log_probs=[-0.15, -0.28, -0.18, -0.42],  # DAPO
)
# result.loss, result.advantages, result.clipped_mask, result.kl_penalty, result.entropy
```

### `reward_scoring.RewardScorer`

Group-normalized reward computation.

```python
scorer = RewardScorer()
norm = scorer.score_group([1.0, 0.5, 0.8, 0.2])
# norm.mean, norm.std, norm.normalized

combined = scorer.combine_rewards(
    task_reward=0.9, format_reward=1.0, safety_reward=0.8,
    weights=(0.6, 0.2, 0.2),
)
```

### `clipping.AsymmetricClipping`

Asymmetric ratio clipping with adaptive bounds.

```python
clipper = AsymmetricClipping(epsilon_low=0.2, epsilon_high=0.3)
clipped = clipper.clip(1.5)  # 1.3
eps_low, eps_high = clipper.adaptive_epsilon(advantages)
```

### `loss_normalization.LossNormalization`

Per-token loss normalization with length bias correction.

```python
normalizer = LossNormalization(lambda_lb=0.01)
loss = normalizer.compute_sequence_loss(
    token_losses=[[0.1, 0.2], [0.3, 0.1, 0.15]],
    sequence_lengths=[2, 3],
)
```

### `rlvr.RLVR`

Deterministic, verifiable reward functions.

```python
rlvr = RLVR()
reward = rlvr.verifiable_reward(
    prediction="42",
    task_type="math",
    verification_data={"reference": "42"},
)
# reward == 1.0

code_reward = rlvr.code_execution_reward(
    code="def add(a, b): return a + b",
    test_cases=[("add(2, 3)", 5), ("add(0, 0)", 0)],
)
# code_reward == 1.0
```

## Data Flow

```
┌──────────────┐
│  Environment │
│  (Tasks)     │
└──────┬───────┘
       │ prompts
       ▼
┌──────────────┐     ┌──────────────┐
│  Policy π_θ  │────▶│  Samples     │
│  (Ava007)    │     │  (G/group)   │
└──────────────┘     └──────┬───────┘
                            │
                     ┌──────▼───────┐
                     │  RLVR        │
                     │  (Verifier)  │
                     └──────┬───────┘
                            │ rewards
                     ┌──────▼───────┐
                     │  RewardScorer│
                     │  (Normalize) │
                     └──────┬───────┘
                            │ advantages
                     ┌──────▼───────┐
                     │  GRPO/DAPO   │
                     │  (Optimize)  │
                     └──────┬───────┘
                            │ gradients
                     ┌──────▼───────┐
                     │  LossNorm    │
                     │  (Correct)   │
                     └──────┬───────┘
                            │
                     ┌──────▼───────┐
                     │  Update π_θ  │
                     └──────────────┘
```

## Dependencies

- Python stdlib only (math, json, re, typing, dataclasses)
- No external packages required
