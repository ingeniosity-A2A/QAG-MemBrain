//! Harness Registry — execution substrates that Skills deploy to.
//!
//! A Harness is WHERE/HOW a Skill runs. A Skill says "what to do";
//! a Harness says "where to run it."
//!
//! # Examples
//!
//!   Skill: `telecom.rotate_identity`
//!     → deploys to Harness: `termux_usb_serial` (modem AT command)
//!     → deploys to Harness: `gsap_temporal` (record rotation event)
//!
//!   Skill: `griptape.run_workflow`
//!     → deploys to Harness: `griptape` (Python orchestration)
//!     → deploys to Harness: `wasm_sandbox` (if workflow is untrusted)
//!
//! # Harness catalog
//!
//! 20 harnesses registered by default (see `default_harnesses()`):
//!   LLM backends: Gemma2B, Gemma12B, Mercury2, Mellum2, Claude, GPT4o, Qwen7B, Embedding384
//!   Expansion: Griptape, AgentZero, Bastani, BinaryNinja
//!   Infrastructure: TelnyxWhatsApp, CloudflareWorker, GSAPTemporal, Neo4jGraphRAG
//!   Consensus: TashiDAG, WASMSandbox
//!   Hardware: LoRaSX1262, TermuxUSBSerial

use std::collections::HashMap;
use std::sync::Arc;

use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use tracing::info;

/// A harness — an execution substrate for Skills.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Harness {
    /// Unique identifier (e.g., "griptape", "mercury2", "termux_usb_serial")
    pub id: String,
    /// Human-readable name
    pub name: String,
    /// What this harness does
    pub function: String,
    /// System prompt (for LLM-backed harnesses) or tool manifest (for others)
    pub system_prompt: Option<String>,
    /// Use cases this harness serves
    pub use_cases: Vec<String>,
    /// Harness category
    pub category: HarnessCategory,
    /// Whether the harness is currently available
    pub available: bool,
    /// Average latency in ms (None for non-time-sensitive harnesses)
    pub avg_latency_ms: Option<u64>,
    /// Cost per invocation (0.0 for local, >0 for cloud APIs)
    pub cost_per_invocation: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum HarnessCategory {
    /// LLM inference backend
    LlmBackend,
    /// Expansion service (subprocess)
    Expansion,
    /// Infrastructure (API, proxy, webhook)
    Infrastructure,
    /// Consensus / distributed
    Consensus,
    /// Hardware bridge
    Hardware,
    /// Sandbox / isolation
    Sandbox,
    /// Temporal / audit
    Temporal,
}

impl HarnessCategory {
    pub fn as_str(self) -> &'static str {
        match self {
            HarnessCategory::LlmBackend     => "llm_backend",
            HarnessCategory::Expansion       => "expansion",
            HarnessCategory::Infrastructure  => "infrastructure",
            HarnessCategory::Consensus       => "consensus",
            HarnessCategory::Hardware        => "hardware",
            HarnessCategory::Sandbox         => "sandbox",
            HarnessCategory::Temporal        => "temporal",
        }
    }
}

/// The harness registry — stores all known harnesses.
pub struct HarnessRegistry {
    harnesses: Arc<RwLock<HashMap<String, Harness>>>,
}

impl HarnessRegistry {
    pub fn new() -> Arc<Self> {
        let registry = Arc::new(Self {
            harnesses: Arc::new(RwLock::new(HashMap::new())),
        });
        // Register all default harnesses
        for h in default_harnesses() {
            registry.register(h);
        }
        registry
    }

    pub fn register(&self, harness: Harness) {
        info!("Registered harness: {} ({})", harness.id, harness.category.as_str());
        self.harnesses.write().insert(harness.id.clone(), harness);
    }

    pub fn get(&self, id: &str) -> Option<Harness> {
        self.harnesses.read().get(id).cloned()
    }

    pub fn all(&self) -> Vec<Harness> {
        self.harnesses.read().values().cloned().collect()
    }

    pub fn by_category(&self, category: HarnessCategory) -> Vec<Harness> {
        self.harnesses.read().values()
            .filter(|h| h.category == category)
            .cloned()
            .collect()
    }

    pub fn available(&self) -> Vec<Harness> {
        self.harnesses.read().values()
            .filter(|h| h.available)
            .cloned()
            .collect()
    }

    pub fn set_available(&self, id: &str, available: bool) {
        if let Some(h) = self.harnesses.write().get_mut(id) {
            h.available = available;
        }
    }

    pub fn count(&self) -> usize {
        self.harnesses.read().len()
    }
}

/// The default harness catalog — 20 harnesses covering all framework capabilities.
pub fn default_harnesses() -> Vec<Harness> {
    vec![
        // ── LLM Backends ──────────────────────────────────────────────
        Harness {
            id: "gemma_2b".into(),
            name: "Gemma 2B (Reflex)".into(),
            function: "Fast local LLM inference via llama-server (port 8080)".into(),
            system_prompt: Some("You are REV.IKE, the user's subconscious interpreter. Provide concise, accurate responses.".into()),
            use_cases: vec!["Reflex".into(), "Classify".into(), "Fast Q&A".into(), "Chitchat".into()],
            category: HarnessCategory::LlmBackend,
            available: true,
            avg_latency_ms: Some(80),
            cost_per_invocation: 0.0,
        },
        Harness {
            id: "gemma_12b".into(),
            name: "Gemma 4 12B (FABLE)".into(),
            function: "Agentic planning via llama-server (port 8081, on-demand)".into(),
            system_prompt: Some("You are FABLE, a planning agent. Decompose the user's request into a sequence of concrete steps.".into()),
            use_cases: vec!["Planning".into(), "Synthesis".into(), "Complex reasoning".into()],
            category: HarnessCategory::LlmBackend,
            available: true,
            avg_latency_ms: Some(2000),
            cost_per_invocation: 0.0,
        },
        Harness {
            id: "mercury2".into(),
            name: "Mercury2 (Cortex)".into(),
            function: "Diffusion LLM via Inception Labs API — flat latency regardless of output length".into(),
            system_prompt: Some("You are the CORTEX tier of AVA007. Use deep reasoning. The executive brain escalated this because it could not resolve it.".into()),
            use_cases: vec!["Deep reasoning".into(), "Policy synthesis".into(), "Novel-type resolution".into()],
            category: HarnessCategory::LlmBackend,
            available: std::env::var("MERCURY2_API_KEY").is_ok(),
            avg_latency_ms: Some(2000),
            cost_per_invocation: 0.002,
        },
        Harness {
            id: "mellum2".into(),
            name: "Mellum2 (Executive)".into(),
            function: "MoE 12B/2.5B active via local Ollama (port 11434)".into(),
            system_prompt: Some("You are the EXECUTIVE tier of AVA007. Route, plan, and escalate as needed.".into()),
            use_cases: vec!["Routing".into(), "Planning".into(), "Escalation".into()],
            category: HarnessCategory::LlmBackend,
            available: true,
            avg_latency_ms: Some(150),
            cost_per_invocation: 0.0,
        },
        Harness {
            id: "embedding_384".into(),
            name: "Embedding 384".into(),
            function: "Vector embedding generation for VSS recall (port 8082)".into(),
            system_prompt: None,
            use_cases: vec!["VSS recall".into(), "Semantic search".into()],
            category: HarnessCategory::LlmBackend,
            available: true,
            avg_latency_ms: Some(15),
            cost_per_invocation: 0.0,
        },
        Harness {
            id: "claude".into(),
            name: "Claude (Cloud Fallback)".into(),
            function: "Anthropic Claude API for complex reasoning fallback".into(),
            system_prompt: Some("You are a cloud reasoning fallback for AVA007.".into()),
            use_cases: vec!["Complex reasoning".into(), "Cloud fallback".into()],
            category: HarnessCategory::LlmBackend,
            available: std::env::var("ANTHROPIC_API_KEY").is_ok(),
            avg_latency_ms: Some(2000),
            cost_per_invocation: 0.015,
        },
        Harness {
            id: "gpt_4o".into(),
            name: "GPT-4o (Cloud Fallback)".into(),
            function: "OpenAI GPT-4o API for tool-use fallback".into(),
            system_prompt: Some("You are a cloud tool-use fallback for AVA007.".into()),
            use_cases: vec!["Tool use".into(), "Code execution".into(), "Cloud fallback".into()],
            category: HarnessCategory::LlmBackend,
            available: std::env::var("OPENAI_API_KEY").is_ok(),
            avg_latency_ms: Some(2000),
            cost_per_invocation: 0.005,
        },
        Harness {
            id: "qwen_7b".into(),
            name: "Qwen 2.5 7B (Multilang)".into(),
            function: "Multilingual local LLM via llama-server (port 8083)".into(),
            system_prompt: Some("You are a multilingual fallback for AVA007.".into()),
            use_cases: vec!["Translation".into(), "Multilingual".into()],
            category: HarnessCategory::LlmBackend,
            available: true,
            avg_latency_ms: Some(150),
            cost_per_invocation: 0.0,
        },
        // ── Expansion Services ────────────────────────────────────────
        Harness {
            id: "griptape".into(),
            name: "Griptape (Python Orchestration)".into(),
            function: "Python orchestration with tool dispatch via `python -m griptape`".into(),
            system_prompt: None,
            use_cases: vec!["Code execution".into(), "Data analysis".into(), "Workflow automation".into()],
            category: HarnessCategory::Expansion,
            available: true,
            avg_latency_ms: Some(5000),
            cost_per_invocation: 0.0,
        },
        Harness {
            id: "agent_zero".into(),
            name: "AgentZero (Browser Automation)".into(),
            function: "Playwright-based browser automation via subprocess".into(),
            system_prompt: None,
            use_cases: vec!["Web scraping".into(), "Form filling".into(), "Browser tasks".into()],
            category: HarnessCategory::Expansion,
            available: true,
            avg_latency_ms: Some(10000),
            cost_per_invocation: 0.0,
        },
        Harness {
            id: "bastani".into(),
            name: "Bastani (Autonomous Engineering)".into(),
            function: "Autonomous engineering loops via subprocess".into(),
            system_prompt: None,
            use_cases: vec!["Code refactoring".into(), "Test generation".into(), "Long-running engineering".into()],
            category: HarnessCategory::Expansion,
            available: true,
            avg_latency_ms: Some(30000),
            cost_per_invocation: 0.0,
        },
        Harness {
            id: "binary_ninja".into(),
            name: "Binary Ninja (Binary Audit)".into(),
            function: "Preview-then-Commit binary audits".into(),
            system_prompt: None,
            use_cases: vec!["Firmware analysis".into(), "Vulnerability scanning".into(), "Patching".into()],
            category: HarnessCategory::Expansion,
            available: true,
            avg_latency_ms: Some(5000),
            cost_per_invocation: 0.0,
        },
        // ── Infrastructure ────────────────────────────────────────────
        Harness {
            id: "telnyx_whatsapp".into(),
            name: "Telnyx WhatsApp".into(),
            function: "Cloud telephony API for WhatsApp messaging + calling".into(),
            system_prompt: None,
            use_cases: vec!["Send WhatsApp".into(), "Receive WhatsApp".into(), "Enable calling".into()],
            category: HarnessCategory::Infrastructure,
            available: std::env::var("AVA007_WORKER_URL").is_ok(),
            avg_latency_ms: Some(2000),
            cost_per_invocation: 0.005,
        },
        Harness {
            id: "cloudflare_worker".into(),
            name: "Cloudflare Worker".into(),
            function: "Edge proxy + webhook ingress — API key vault, rate limiting".into(),
            system_prompt: None,
            use_cases: vec!["API key protection".into(), "Rate limiting".into(), "Webhook tunnel".into()],
            category: HarnessCategory::Infrastructure,
            available: std::env::var("AVA007_WORKER_URL").is_ok(),
            avg_latency_ms: Some(50),
            cost_per_invocation: 0.0,
        },
        Harness {
            id: "gsap_temporal".into(),
            name: "GSAP Temporal Engine".into(),
            function: "Timeline recording + deterministic replay (audit layer)".into(),
            system_prompt: None,
            use_cases: vec!["Audit trail".into(), "State reconstruction".into(), "Insert intelligence".into()],
            category: HarnessCategory::Temporal,
            available: true,
            avg_latency_ms: Some(1),
            cost_per_invocation: 0.0,
        },
        Harness {
            id: "neo4j_graphrag".into(),
            name: "Neo4j GraphRAG".into(),
            function: "Graph + vector query in one call — deep context retrieval".into(),
            system_prompt: None,
            use_cases: vec!["Deep context retrieval".into(), "Ancestry walks".into(), "Graph queries".into()],
            category: HarnessCategory::Infrastructure,
            available: std::env::var("NEO4J_URI").is_ok(),
            avg_latency_ms: Some(100),
            cost_per_invocation: 0.0,
        },
        // ── Consensus ─────────────────────────────────────────────────
        Harness {
            id: "tashi_dag".into(),
            name: "Tashi DAG Consensus".into(),
            function: "Leaderless DAG consensus for distributed state agreement".into(),
            system_prompt: None,
            use_cases: vec!["Cross-device memory sync".into(), "Offline queue flush".into()],
            category: HarnessCategory::Consensus,
            available: true,
            avg_latency_ms: Some(10),
            cost_per_invocation: 0.0,
        },
        Harness {
            id: "wasm_sandbox".into(),
            name: "WASM Sandbox".into(),
            function: "Isolated capability execution in WASM runtime".into(),
            system_prompt: None,
            use_cases: vec!["Untrusted code execution".into(), "Evolvable capabilities".into()],
            category: HarnessCategory::Sandbox,
            available: true,
            avg_latency_ms: Some(5),
            cost_per_invocation: 0.0,
        },
        // ── Hardware ──────────────────────────────────────────────────
        Harness {
            id: "lora_sx1262".into(),
            name: "LoRa SX1262".into(),
            function: "Sub-GHz mesh radio for long-range low-bandwidth D2D".into(),
            system_prompt: None,
            use_cases: vec!["Long-range mesh".into(), "IoT sensor roaming".into()],
            category: HarnessCategory::Hardware,
            available: false, // requires physical hardware
            avg_latency_ms: Some(1000),
            cost_per_invocation: 0.0,
        },
        Harness {
            id: "termux_usb_serial".into(),
            name: "Termux USB Serial".into(),
            function: "Hardware bridge via USB serial (modem, sensors, IO)".into(),
            system_prompt: None,
            use_cases: vec!["Modem control".into(), "Sensor reading".into(), "Hardware IO".into()],
            category: HarnessCategory::Hardware,
            available: true,
            avg_latency_ms: Some(50),
            cost_per_invocation: 0.0,
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_starts_with_20_harnesses() {
        let reg = HarnessRegistry::new();
        assert_eq!(reg.count(), 20);
    }

    #[test]
    fn llm_backends_category_has_8() {
        let reg = HarnessRegistry::new();
        let llm = reg.by_category(HarnessCategory::LlmBackend);
        assert_eq!(llm.len(), 8);
    }

    #[test]
    fn griptape_harness_exists() {
        let reg = HarnessRegistry::new();
        let h = reg.get("griptape").unwrap();
        assert_eq!(h.category, HarnessCategory::Expansion);
        assert!(h.use_cases.contains(&"Code execution".to_string()));
    }

    #[test]
    fn mercury2_availability_depends_on_api_key() {
        std::env::remove_var("MERCURY2_API_KEY");
        let reg = HarnessRegistry::new();
        let h = reg.get("mercury2").unwrap();
        assert!(!h.available); // no API key → unavailable
    }

    #[test]
    fn set_available_toggles_state() {
        let reg = HarnessRegistry::new();
        reg.set_available("lora_sx1262", true);
        let h = reg.get("lora_sx1262").unwrap();
        assert!(h.available);
    }
}
