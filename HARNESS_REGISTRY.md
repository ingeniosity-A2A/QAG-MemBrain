# AVA007 — Harness Registry

Harnesses are **execution substrates** that Skills deploy to. A Skill
says "what to do"; a Harness says "where/how to run it."

The Meta Harness picks the right Harness at runtime based on:
- Availability (is the harness loaded?)
- Cost (token budget)
- Latency budget
- Thermal state
- FAPO Arena (Pareto-optimal selection)

## Catalog (20 Harnesses)

### LLM Backends (8)

| # | ID | Name | Function | System Prompt | Use Cases | Latency | Cost |
|---|-----|------|----------|---------------|-----------|---------|------|
| 1 | `gemma_2b` | Gemma 2B (Reflex) | Fast local LLM via llama-server (port 8080) | "You are REV.IKE, the user's subconscious interpreter. Provide concise, accurate responses." | Reflex, Classify, Fast Q&A, Chitchat | 80ms | $0 |
| 2 | `gemma_12b` | Gemma 4 12B (FABLE) | Agentic planning via llama-server (port 8081) | "You are FABLE, a planning agent. Decompose the user's request into a sequence of concrete steps." | Planning, Synthesis, Complex reasoning | 2s | $0 |
| 3 | `mercury2` | Mercury2 (Cortex) | Diffusion LLM via Inception Labs API | "You are the CORTEX tier of AVA007. Use deep reasoning. The executive brain escalated this because it could not resolve it." | Deep reasoning, Policy synthesis, Novel-type resolution | 2s | $0.002/1k |
| 4 | `mellum2` | Mellum2 (Executive) | MoE 12B/2.5B active via local Ollama (port 11434) | "You are the EXECUTIVE tier of AVA007. Route, plan, and escalate as needed." | Routing, Planning, Escalation | 150ms | $0 |
| 5 | `embedding_384` | Embedding 384 | Vector embedding generation (port 8082) | (none — not an LLM) | VSS recall, Semantic search | 15ms | $0 |
| 6 | `claude` | Claude (Cloud Fallback) | Anthropic Claude API | "You are a cloud reasoning fallback for AVA007." | Complex reasoning, Cloud fallback | 2s | $0.015/1k |
| 7 | `gpt_4o` | GPT-4o (Cloud Fallback) | OpenAI GPT-4o API | "You are a cloud tool-use fallback for AVA007." | Tool use, Code execution, Cloud fallback | 2s | $0.005/1k |
| 8 | `qwen_7b` | Qwen 2.5 7B (Multilang) | Multilingual local LLM (port 8083) | "You are a multilingual fallback for AVA007." | Translation, Multilingual | 150ms | $0 |

### Expansion Services (4)

| # | ID | Name | Function | Use Cases | Latency |
|---|-----|------|----------|-----------|---------|
| 9 | `griptape` | Griptape (Python Orchestration) | Python orchestration with tool dispatch via `python -m griptape` | Code execution, Data analysis, Workflow automation | 5s |
| 10 | `agent_zero` | AgentZero (Browser Automation) | Playwright-based browser automation via subprocess | Web scraping, Form filling, Browser tasks | 10s |
| 11 | `bastani` | Bastani (Autonomous Engineering) | Autonomous engineering loops via subprocess | Code refactoring, Test generation, Long-running engineering | 30s |
| 12 | `binary_ninja` | Binary Ninja (Binary Audit) | Preview-then-Commit binary audits | Firmware analysis, Vulnerability scanning, Patching | 5s |

### Infrastructure (4)

| # | ID | Name | Function | Use Cases |
|---|-----|------|----------|-----------|
| 13 | `telnyx_whatsapp` | Telnyx WhatsApp | Cloud telephony API for WhatsApp messaging + calling | Send WhatsApp, Receive WhatsApp, Enable calling |
| 14 | `cloudflare_worker` | Cloudflare Worker | Edge proxy + webhook ingress — API key vault, rate limiting | API key protection, Rate limiting, Webhook tunnel |
| 15 | `gsap_temporal` | GSAP Temporal Engine | Timeline recording + deterministic replay (audit layer) | Audit trail, State reconstruction, **Insert intelligence** |
| 16 | `neo4j_graphrag` | Neo4j GraphRAG | Graph + vector query in one call — deep context retrieval | Deep context retrieval, Ancestry walks, Graph queries |

### Consensus + Sandbox (2)

| # | ID | Name | Function | Use Cases |
|---|-----|------|----------|-----------|
| 17 | `tashi_dag` | Tashi DAG Consensus | Leaderless DAG consensus for distributed state agreement | Cross-device memory sync, Offline queue flush |
| 18 | `wasm_sandbox` | WASM Sandbox | Isolated capability execution in WASM runtime | Untrusted code execution, Evolvable capabilities |

### Hardware (2)

| # | ID | Name | Function | Use Cases |
|---|-----|------|----------|-----------|
| 19 | `lora_sx1262` | LoRa SX1262 | Sub-GHz mesh radio for long-range low-bandwidth D2D | Long-range mesh, IoT sensor roaming |
| 20 | `termux_usb_serial` | Termux USB Serial | Hardware bridge via USB serial (modem, sensors, IO) | Modem control, Sensor reading, Hardware IO |

## Skill → Harness Deployment Matrix

| Skill | Deploys to | NOT deployed to |
|-------|-----------|-----------------|
| `telecom.rotate_identity` | `termux_usb_serial`, `gsap_temporal` | `mercury2` (no reasoning needed) |
| `telecom.detect_imsi_catcher` | `mellum2` (classify RF), `neo4j_graphrag` (lookup), `gsap_temporal` (record) | `griptape` (no Python needed) |
| `telecom.steer_backhaul` | `termux_usb_serial` (modem), `gsap_temporal` (record) | `mercury2` (not a reasoning task) |
| `telecom.purge_logs` | `gsap_temporal` (purge timeline), `neo4j_graphrag` (extract features first) | `gemma_2b` (no LLM needed) |
| `telecom.train_dli` | `griptape` (Python+PyTorch), `gsap_temporal` (record training) | `binary_ninja` (not a binary task) |
| `griptape.run_workflow` | `griptape` (primary), `wasm_sandbox` (if untrusted) | `mercury2` (not a reasoning task) |
| `latent_skill.acquire` | `mellum2` (hypernetwork call), `gsap_temporal` (cache) | `telnyx_whatsapp` (irrelevant) |
| `binary_ninja.audit` | `binary_ninja` (primary) | `griptape` (different tool) |

## API

```rust
use harness::{HarnessRegistry, HarnessCategory};

let registry = HarnessRegistry::new();  // 20 harnesses auto-registered

// Get a specific harness
let mercury = registry.get("mercury2").unwrap();
println!("{}: {}", mercury.name, mercury.function);

// List all available harnesses
for h in registry.available() {
    println!("  [{}] {} — {}", h.category.as_str(), h.id, h.name);
}

// Filter by category
let llm_backends = registry.by_category(HarnessCategory::LlmBackend);
// Returns 8 LLM backends

// Toggle availability
registry.set_available("lora_sx1262", true);  // hardware connected
```

## Adding a New Harness

```rust
registry.register(Harness {
    id: "my_new_harness".into(),
    name: "My New Harness".into(),
    function: "Does something cool".into(),
    system_prompt: Some("You are...".into()),
    use_cases: vec!["Thing 1".into(), "Thing 2".into()],
    category: HarnessCategory::Expansion,
    available: true,
    avg_latency_ms: Some(500),
    cost_per_invocation: 0.0,
});
```

## Integration Points

- **Constellation** reads the harness registry to know which models are available for routing
- **Meta Harness** picks a harness when a Skill declares multiple deployment targets
- **FAPO Arena** selects the Pareto-optimal harness when multiple can serve the same request
- **harness_evolution** tracks harness performance + A/B tests new configurations
- **GSAP Temporal** records every harness invocation as a timeline event
