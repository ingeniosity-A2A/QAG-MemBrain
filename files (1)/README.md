# /brain — Dual Brain Cognition (Layer 3)

Three escalating tiers. Token cost is incurred only here.
Layers 0–2 are crypto operations and rule-based routing — zero LLM calls.

## /reflex
On-device model (Nemotron Nano / Gemma). Target latency: <50ms. ~100 tokens.

Handles atoms when ALL of:
- `type` is in the known pattern set
- `confidence >= 0.85`
- `importance` is not `critical`
- No multi-atom context required

## /executive
Mellum2 MoE (12B total, 2.5B active). Orchestration and routing. ~500 tokens.
Assembles a complete context packet before any cortex escalation — no partial commits.

## /cortex
Mercury 2 (diffusion) + Ava007 control plane. Full timeline slice, 1k+ tokens.

Mercury 2 constraint: context must be complete before the call.
Parallel refinement passes — no mid-generation steering. Output length does not increase latency.

Escalation triggers (any one is sufficient):
- `importance: critical`
- Novel `type` with no DAG match
- Policy conflict between DAG paths
- Executive confidence < 0.60

## Target escalation ratios (steady state)
- Reflex: >=70% of atoms
- Executive: ~25%
- Cortex: <=5%
