# LAYER 6: DualBrain Inference Router

Confidence-threshold routing between **Graph** (deterministic, no LLM) and **Prompt** (LLM-powered) retrieval, with a **Hybrid** mode that combines both.

## Architecture

```
                        ┌─────────────────────┐
                        │   DualBrainRouter    │
                        │   (Reflex Tier)      │
                        └─────────┬───────────┘
                                  │
                         route(query, context)
                                  │
                    ┌─────────────┼─────────────┐
                    ▼             ▼             ▼
              ┌──────────┐ ┌──────────┐ ┌──────────┐
              │  GRAPH   │ │  PROMPT  │ │ HYBRID   │
              │  Mode    │ │  Mode    │ │  Mode    │
              └────┬─────┘ └────┬─────┘ └────┬─────┘
                   │            │            │
                   ▼            ▼            ▼
              Graph        mellum2       Phase 1: Graph
              Traversal    (Executive)   Phase 2: Prompt
              (L3 GraphRAG)              + Contradiction
                                          Detection
```

## Three Routing Modes

| Mode | Engine | Latency | Tokens | Best For |
|------|--------|---------|--------|----------|
| **GRAPH** | Deterministic graph traversal | ~5ms | 0 | Factual lookups, entity queries, status checks |
| **PROMPT** | LLM generation (mellum2/mercury2) | ~800ms | 256–2048 | Creative tasks, explanations, synthesis |
| **HYBRID** | Graph → Prompt augmentation | ~850ms | 128–1536 | Analytical queries, mixed factual+creative |

## Three Routing Strategies

| Strategy | PROMPT Threshold | Bias | Use Case |
|----------|-----------------|------|----------|
| **CONSERVATIVE** | 0.7 | Prefer GRAPH | Cost-sensitive, high-precision required |
| **BALANCED** | 0.5 | Neutral | Default — balanced cost/quality |
| **AGGRESSIVE** | 0.3 | Prefer PROMPT | Quality-first, creative tasks |

## Three-Tier Integration

The DualBrain router maps to the Ava007Orchestrator tiers:

- **Reflex** → `DualBrainRouter.route()` — fast classification and mode decision
- **Executive** → `execute_prompt()` with mellum2 — planning and orchestration
- **Cortex** → `execute_hybrid()` with mercury2 — deep synthesis and learning

## Query Classification

Queries are classified into four types:

- **Factual** — WH-questions, lookups, boolean queries → GRAPH preferred
- **Analytical** — Why/how, compare, evaluate → HYBRID preferred
- **Creative** — Generate, design, imagine → PROMPT preferred
- **Mixed** — Overlapping patterns → HYBRID for comprehensive coverage

## Module Overview

### `dualbrain_router.py` — Core Router

```python
from ava007.membrain.dualbrain import DualBrainRouter, RoutingStrategy

router = DualBrainRouter(strategy=RoutingStrategy.BALANCED)

# Route a query
decision = router.route("What is the capital of France?")
# → RoutingDecision(mode="GRAPH", confidence=0.85, reason="Factual query → GRAPH ...")

# Execute in a specific mode
graph_result = router.execute_graph("status of deployment", graph_data)
prompt_result = router.execute_prompt("Explain the deployment process")
hybrid_result = router.execute_hybrid("Compare deployment strategies", graph_data)

# Change strategy at runtime
router.set_routing_strategy(RoutingStrategy.AGGRESSIVE)
```

### `routing.py` — Routing Engine

```python
from ava007.membrain.dualbrain import RoutingEngine, RoutingContext, RoutingStrategy

engine = RoutingEngine(strategy=RoutingStrategy.BALANCED)

# Classify a query
cls = engine.classify_query("Why did the deployment fail?")
# → QueryClassification(type="analytical", has_entity=False, requires_reasoning=True)

# Compute confidence
ctx = RoutingContext(confidence=0.6, available_graph_nodes=150)
conf = engine.compute_confidence("Why did the deployment fail?", ctx)

# Decide route
mode = engine.decide_route(cls, conf, RoutingStrategy.BALANCED)
# → RoutingMode.HYBRID

# Estimate costs
latency = engine.estimate_latency(mode, ctx)   # ms
tokens = engine.estimate_token_budget(mode, ctx)  # tokens
```

### `augmentation.py` — Query Augmenter

```python
from ava007.membrain.dualbrain import QueryAugmenter

augmenter = QueryAugmenter()

# Factual detection
augmenter.is_factual("Who is the president of France?")  # True
augmenter.is_factual("Write a poem about the sea")       # False

# Entity extraction
augmenter.extract_entities('What is the status of "Project Aurora"?')
# → ["Project Aurora"]

# Graph context augmentation
augmented = augmenter.augment_with_graph_context(query, graph_data)
print(augmented.augmented)   # query with graph context prepended
print(augmented.entities)     # extracted entities
print(augmented.context_sources)  # ["graph:node:deployment_42", ...]

# Contradiction detection
contradictions = augmenter.detect_contradictions(graph_answer, prompt_answer)
for c in contradictions:
    print(f"{c.severity}: {c.topic} — graph says {c.graph_claim}, prompt says {c.prompt_claim}")
```

## Data Structures

| Structure | Fields | Purpose |
|-----------|--------|---------|
| `RoutingContext` | confidence, importance, source, query_type, available_graph_nodes, has_policy_conflicts | Input context for routing |
| `RoutingDecision` | mode, confidence, reason, estimated_latency_ms, token_budget | Routing decision output |
| `GraphResult` | answer, paths, confidence, source_nodes | GRAPH mode result |
| `PromptResult` | answer, tokens_used, confidence, model | PROMPT mode result |
| `HybridResult` | graph_result, prompt_result, final_answer, confidence, mode | HYBRID mode result |
| `QueryClassification` | type, keywords, has_entity, requires_reasoning | Query type classification |
| `AugmentedQuery` | original, augmented, entities, context_sources, is_factual | Augmented query |
| `Contradiction` | topic, graph_claim, prompt_claim, severity | Detected contradiction |

## Wiring to Ava007Orchestrator

The dualbrain layer integrates with the TypeScript runtime via:

- `src/agent/ava007/orchestrator.ts` — Three-tier coordination loop calls into the router
- `src/agent/ava007/mellum2.ts` — Executive LLM client for PROMPT mode
- `src/agent/ava007/mercury2.ts` — Cortex LLM client for HYBRID synthesis phase
- `src/agent/cortex/reflex/gemmaQueryTransformer.ts` — Query transformation before routing
- `src/agent/cortex/executive/mercury2SynthesisClient.ts` — Cortex synthesis after HYBRID

## Testing

```bash
cd ava007/membrain
python -m pytest dualbrain/ -v
```

## Dependencies

Python stdlib only: `re`, `dataclasses`, `typing`, `enum`, `json`, `time`, `collections`.
