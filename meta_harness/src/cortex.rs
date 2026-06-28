//! L6 Cortex — Deep reasoning tier (Mercury2 diffusion)
//!
//! Ported from `files(9)/dual_brain.ts` (white paper §3, L6 Cortex tier).
//!
//! The Cortex tier receives atoms that the Executive (Mellum2) couldn't
//! resolve. It calls Mercury2 diffusion for deep reasoning.
//!
//! Escalation chain: Reflex (Gemma 2B) → Executive (Mellum2) → Cortex (Mercury2)

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tracing::{info, warn};

use lite_notebook::receipt::{Origin, Receipt, ReceiptKind};

/// A packet sent from the Executive to the Cortex when escalating.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CortexPacket {
    /// The atom requiring deep reasoning
    pub atom: Receipt,
    /// Why the executive escalated
    pub escalation_reason: String,
    /// The executive's interpretation of intent
    pub intent: String,
    /// Current policy context (for conflict detection)
    pub policy_context: String,
    /// Ancestor DAG slice (up to 20 atoms)
    pub dag_slice: Vec<Receipt>,
}

/// The result of Cortex processing.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CortexResult {
    pub decision: String,
    pub confidence: f32,
    pub reasoning: String,
    pub latency_ms: u64,
}

/// The Cortex tier — calls Mercury2 diffusion for deep reasoning.
pub struct Cortex {
    mercury2: Arc<crate::inference::LlamaServerBackend>,
}

impl Cortex {
    /// Create a new Cortex wired to the Mercury2 backend.
    /// In production, this uses constellation::backends::Mercury2Backend.
    /// For now, it uses the LlamaServerBackend (which can point at any
    /// OpenAI-compatible API including Mercury2's endpoint).
    pub fn new(mercury2: Arc<crate::inference::LlamaServerBackend>) -> Self {
        Self { mercury2 }
    }

    /// Process a CortexPacket — call Mercury2 diffusion for deep reasoning.
    pub async fn process(&self, packet: CortexPacket) -> anyhow::Result<CortexResult> {
        let prompt = self.build_cortex_prompt(&packet);

        let req = crate::inference::InferenceRequest {
            prompt: prompt.into(),
            max_tokens: 1024,
            temperature: 0.7,
            top_p: 0.95,
            stop_tokens: vec!["\n\n\n".into()],
            model: crate::policy::ModelChoice::Gemma2B, // Will be Mercury2 when wired
        };

        let start = std::time::Instant::now();
        let resp = self.mercury2.generate(req).await?;
        let latency_ms = start.elapsed().as_millis() as u64;

        info!("Cortex processed (latency={}ms, tokens={})",
              latency_ms, resp.tokens_generated);

        Ok(CortexResult {
            decision: "resolved".into(),
            confidence: 0.85,
            reasoning: resp.text.to_string(),
            latency_ms,
        })
    }

    /// Build the complete prompt for Mercury2.
    /// Context must be COMPLETE before the call — no mid-call steering.
    fn build_cortex_prompt(&self, packet: &CortexPacket) -> String {
        let dag_context: String = packet.dag_slice.iter()
            .enumerate()
            .map(|(i, a)| {
                format!("[{}] trust={:.2}\n    content: {}",
                        i + 1, a.trust_score, a.content)
            })
            .collect::<Vec<_>>()
            .join("\n");

        format!(
            "You are the cortex of the AVA007 cognitive system.\n\
             The executive brain escalated this atom because it could not resolve it.\n\n\
             ESCALATION REASON: {}\n\
             EXECUTIVE INTENT: {}\n\n\
             CURRENT POLICY CONTEXT:\n{}\n\n\
             ATOM REQUIRING DEEP REASONING:\n\
             \x20 id: {}\n\
             \x20 trust score: {:.2}\n\
             \x20 content: {}\n\n\
             ANCESTOR DAG SLICE ({} atoms):\n{}\n\n\
             YOUR RESPONSIBILITIES:\n\
             1. Analyze the atom in the context of its DAG ancestry\n\
             2. Identify any policy conflicts\n\
             3. Produce a decision with reasoning\n",
            packet.escalation_reason,
            packet.intent,
            packet.policy_context,
            packet.atom.id,
            packet.atom.trust_score,
            packet.atom.content,
            packet.dag_slice.len(),
            if dag_context.is_empty() { "  none — novel atom".into() } else { dag_context },
        )
    }
}
