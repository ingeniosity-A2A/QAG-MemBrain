# AVA007 — Build vs Inject Decision Framework

## When to BUILD code vs INJECT intelligence

Not every piece of intelligence needs new Rust/Python code. The framework
has multiple insertion paths. Use this table to decide.

## Decision Matrix

| Intelligence type | INJECT as data | INJECT via GSAP | INJECT as config | BUILD as code |
|---|---|---|---|---|
| Facts, parameters, hyperparameters | ✅ `LiteNotebook::deposit()` with `atommem_directive=Create` | ✅ `gsap_temporal.insertIntelligence()` | ❌ | ❌ |
| Reward function weights, V trade-off factor | ✅ Same — store as metadata | ✅ Same | ❌ | ❌ |
| Model routing preferences | ❌ | ❌ | ✅ Constellation registry entry | ❌ |
| Prompt templates, system prompts | ✅ Core Memory Receipt | ✅ GSAP timeline | ❌ | ❌ |
| New RL training algorithm (Double DQN, GRPO) | ❌ | ❌ | ❌ | ✅ New `training/` module |
| New physical-layer protocol (5-tier mesh) | ❌ | ❌ | ❌ | ✅ New `goose/src/` module |
| New API integration (Telnyx, Mercury2) | ❌ | ❌ | ❌ | ✅ New backend or crate |
| New UI component | ❌ | ❌ | ❌ | ✅ New `.tsx` in `mobile/capacitor/` |
| New Skill (telecom, latent-skill) | ⚠️ Params only | ❌ | ❌ | ✅ New `skills/` entry |

## Insertion Paths (all accepted)

### Path 1: `LiteNotebook::deposit()` — Primary insert
The main way to insert intelligence. Every Receipt deposited becomes
part of the immutable Context Ocean.

```rust
let receipt = Receipt::new(
    session_id, Origin::Tashi, ReceiptKind::Memory,
    "DLI hyperparameters: lr=0.0000625, target_update=32000".into(),
    None,
)
.with_atommem_directive(AtomMemDirective::Create {
    atom_type: "dli_config".into(),
    tags: vec!["telecom".into(), "hyperparameters".into()],
});

ocean.deposit(receipt).await?;
```

### Path 2: `gsap_temporal.insertIntelligence()` — GSAP timeline insert
Records intelligence at a specific point in the GSAP timeline. The
white paper says "insertIntelligence() is the primary operation, GSAP
timeline is the audit layer" — but GSAP can ALSO be used to insert,
not just audit.

```typescript
// In the TypeScript runtime (mobile-runtime/src/temporal/)
temporal.insertIntelligence('telecom.dli_config', {
    hyperparameters: { lr: 0.0000625, target_update: 32000 },
    reward_function: { V: 20, squared_term: true },
});
```

### Path 3: Constellation registry — Config insert
For model routing preferences. Add a new model to the registry and
Constellation will route to it when the intent matches.

```rust
// In constellation/src/registry.rs
ModelConfig {
    id: ModelId::Mercury2,
    endpoint: ModelEndpoint::Cloud { ... },
    capabilities: vec!["deep_reasoning".into()],
    ...
}
```

### Path 4: Build new code — When none of the above suffice
New algorithms, new protocols, new APIs, new UI. This is the slowest
path but the only one that adds new computational capability.

```bash
# New crate
mkdir -p new_crate/src
# Write Cargo.toml + lib.rs
# Add to workspace Cargo.toml
```

## Applied to the DLI Intelligence Report

| DLI component | Decision | Path | Target |
|---|---|---|---|
| State space definition ($s_t$) | INJECT as data | Path 1 | Core Memory Receipt |
| Action space ($a_t$) | INJECT as data | Path 1 | Same Receipt |
| Reward function ($R_t$) + V factor | INJECT as data | Path 1 | Same Receipt |
| Rainbow hyperparameters | INJECT as data | Path 1 | Same Receipt + `dli_config.json` |
| Double DQN training loop | BUILD as code | Path 4 | `training/dli/double_dqn.py` |
| Lyapunov drift-plus-penalty | BUILD as code | Path 4 | `training/dli/double_dqn.py` (LyapunovController class) |
| JCAS fusion kernel | BUILD as code | Path 4 | `skills/telecom/jcas.py` |
| E-band + Microwave IP steering | BUILD as code | Path 4 | `skills/telecom/backhaul.py` |
| Identity rotation | BUILD as code | Path 4 | `skills/telecom/identity_rotation.py` |
| Telecom as a Skill (wrapper) | BUILD as code | Path 4 | `skills/telecom/__init__.py` |

## The Golden Rule

**Default to INJECT. Only BUILD when the intelligence requires new computation.**

If you can express the intelligence as data (parameters, configs, prompts),
inject it. If you need new code to PROCESS that intelligence (train a model,
run a protocol, call an API), build it.

Every INJECT is auditable in the Context Ocean. Every BUILD is versioned
in git + tracked by harness_evolution.
