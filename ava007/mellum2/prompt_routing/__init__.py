# Prompt Routing

Routes atoms to the correct prompt template and Mellum2 MoE expert.

## Strategy

- **Known patterns** → Pre-built prompt templates with slot filling (reflex-tier speed)
- **Novel patterns** → Dynamic prompt assembly via Gemma query transformer
- **Operator precedents** → Injected before every decision for consistency

## MoE Expert Selection

Mellum2 activates 2.5B of 12B parameters per token. Prompt routing determines which expert weights are loaded:
- Code/execution tasks → Goose expert
- Retrieval/synthesis tasks → RevIke expert
- Policy/governance tasks → Authority expert
