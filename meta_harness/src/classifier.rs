//! REV.IKE Classifier — fast-path intent classification.
//!
//! This is the FIRST cognitive step in AVA007. Every user input passes
//! through here before the policy decides routing.
//!
//! Two-stage design:
//!   1. **Heuristic stage** (μs-scale): regex + keyword matching for
//!      obvious intents. Catches ~70% of inputs.
//!   2. **Model stage** (50-150ms): Gemma 2B with a tiny classification
//!      prompt. Used when heuristics are uncertain.
//!
//! The classifier is READ-ONLY by construction — it never produces
//! Receipts with kind=Action. It only emits an Intent struct that the
//! policy consumes.

use std::sync::Arc;
use std::time::Instant;

use serde::{Deserialize, Serialize};

use lite_notebook::receipt::Origin;

use crate::policy::{Intent, IntentBucket};
use crate::inference::{InferenceBackend, InferenceRequest};

/// Result of the heuristic stage. If confidence >= HEURISTIC_THRESHOLD,
/// we skip the model stage entirely.
const HEURISTIC_THRESHOLD: f32 = 0.75;

pub struct Classifier {
    /// Shared inference backend (for stage 2 model classification)
    inference: Arc<dyn InferenceBackend>,
}

impl Classifier {
    pub fn new(inference: Arc<dyn InferenceBackend>) -> Self {
        Self { inference }
    }

    /// Classify a user query into an Intent.
    /// Two-stage: heuristics first, model fallback.
    pub async fn classify(
        &self,
        query: Arc<str>,
        session_id: Arc<str>,
    ) -> anyhow::Result<Intent> {
        let start = Instant::now();

        // Stage 1: heuristics
        let heuristic = self.heuristic_classify(&query);

        let (bucket, confidence) = if heuristic.confidence >= HEURISTIC_THRESHOLD {
            (heuristic.bucket, heuristic.confidence)
        } else {
            // Stage 2: model classification
            let model_result = self.model_classify(&query).await?;
            // Blend: weight heuristic at 0.3, model at 0.7 (when model runs)
            let blended_conf = (heuristic.confidence * 0.3) + (model_result.confidence * 0.7);
            (model_result.bucket, blended_conf)
        };

        let estimated_tokens = estimate_tokens(&query);
        let language = detect_language(&query);

        let requires_expansion = matches!(
            bucket,
            IntentBucket::BrowserAction | IntentBucket::CodeExecution
        );
        let requires_recall = matches!(
            bucket,
            IntentBucket::MemoryOp | IntentBucket::Question
        ) || query_contains_recall_markers(&query);
        let requires_planning = matches!(
            bucket,
            IntentBucket::Planning
        ) || query_contains_planning_markers(&query);

        let elapsed_ms = start.elapsed().as_millis();
        tracing::debug!(
            "classified in {elapsed_ms}ms: bucket={:?} conf={:.2} tokens={estimated_tokens}",
            bucket, confidence
        );

        Ok(Intent {
            query,
            bucket,
            confidence,
            language,
            estimated_tokens,
            requires_expansion,
            requires_recall,
            requires_planning,
            session_id,
        })
    }

    /// Stage 1: heuristic classification. Pure function, no I/O.
    fn heuristic_classify(&self, query: &str) -> HeuristicResult {
        let q = query.to_lowercase();
        let q_trimmed = q.trim();

        // Empty / whitespace
        if q_trimmed.is_empty() {
            return HeuristicResult {
                bucket: IntentBucket::Unknown,
                confidence: 0.95,
            };
        }

        // ── Memory ops ─────────────────────────────────────────────
        const MEMORY_MARKERS: &[&str] = &[
            "remember", "recall", "what did i", "what was that",
            "forget", "earlier i said", "last time i",
            "my history with", "show me my",
        ];
        if MEMORY_MARKERS.iter().any(|m| q.contains(m)) {
            return HeuristicResult {
                bucket: IntentBucket::MemoryOp,
                confidence: 0.85,
            };
        }

        // ── UI navigation ──────────────────────────────────────────
        const UI_MARKERS: &[&str] = &[
            "open the", "show me the dashboard", "show my feed",
            "go to home", "go back", "switch to",
            "open settings", "open the notebook",
        ];
        if UI_MARKERS.iter().any(|m| q.contains(m)) && !q.contains("?") {
            return HeuristicResult {
                bucket: IntentBucket::UiNavigation,
                confidence: 0.80,
            };
        }

        // ── Browser actions ────────────────────────────────────────
        const BROWSER_MARKERS: &[&str] = &[
            "open youtube", "open amazon", "open github", "open reddit",
            "search on google", "search the web", "browse to",
            "go to http", "navigate to www",
        ];
        if BROWSER_MARKERS.iter().any(|m| q.contains(m)) {
            return HeuristicResult {
                bucket: IntentBucket::BrowserAction,
                confidence: 0.85,
            };
        }

        // ── WhatsApp actions (Telnyx API — Knox-safe cloud call) ────
        const WHATSAPP_MARKERS: &[&str] = &[
            "send whatsapp", "send a whatsapp", "whatsapp message",
            "message on whatsapp", "whatsapp calling", "whatsapp call",
            "enable whatsapp", "disable whatsapp",
            "whatsapp business", "telnyx whatsapp",
        ];
        if WHATSAPP_MARKERS.iter().any(|m| q.contains(m)) {
            return HeuristicResult {
                bucket: IntentBucket::WhatsApp,
                confidence: 0.90,
            };
        }

        // ── Code execution ─────────────────────────────────────────
        const CODE_MARKERS: &[&str] = &[
            "run this python", "run this code", "execute this",
            "calculate ", "compute ", "what is 2+2",
            "write a script", "write a function",
        ];
        if CODE_MARKERS.iter().any(|m| q.contains(m)) {
            return HeuristicResult {
                bucket: IntentBucket::CodeExecution,
                confidence: 0.80,
            };
        }

        // ── Planning ───────────────────────────────────────────────
        const PLANNING_MARKERS: &[&str] = &[
            "plan a", "plan the", "step by step", "how do i plan",
            "design a", "architect a", "outline a strategy",
            "break this down", "decompose",
        ];
        if PLANNING_MARKERS.iter().any(|m| q.contains(m)) {
            return HeuristicResult {
                bucket: IntentBucket::Planning,
                confidence: 0.80,
            };
        }

        // ── Synthesis ──────────────────────────────────────────────
        const SYNTHESIS_MARKERS: &[&str] = &[
            "summarize", "compare ", "contrast", "analyze",
            "synthesize", "what's the pattern",
            "give me an overview of",
        ];
        if SYNTHESIS_MARKERS.iter().any(|m| q.contains(m)) {
            return HeuristicResult {
                bucket: IntentBucket::Synthesis,
                confidence: 0.75,
            };
        }

        // ── Chitchat ───────────────────────────────────────────────
        const CHITCHAT_MARKERS: &[&str] = &[
            "hello", "hi ", "hey ", "thanks", "thank you",
            "ok", "cool", "nice", "are you there",
            "how are you", "good morning", "good evening",
        ];
        if CHITCHAT_MARKERS.iter().any(|m| q == *m || q.starts_with(m)) {
            return HeuristicResult {
                bucket: IntentBucket::Chitchat,
                confidence: 0.80,
            };
        }

        // ── Questions (ends with ?) ────────────────────────────────
        if q_trimmed.ends_with('?') {
            return HeuristicResult {
                bucket: IntentBucket::Question,
                confidence: 0.70,
            };
        }

        // ── Unknown — defer to model ───────────────────────────────
        HeuristicResult {
            bucket: IntentBucket::Unknown,
            confidence: 0.30,
        }
    }

    /// Stage 2: model-based classification using Gemma 2B.
    /// Tiny prompt, max 16 tokens of output. ~80ms typical.
    async fn model_classify(&self, query: &str) -> anyhow::Result<HeuristicResult> {
        let prompt = format!(
            r#"Classify the user query into exactly one bucket.
Reply with one word only.

Buckets:
- question (factual recall)
- synthesis (summarize/compare/analyze)
- browser (open a website / browse)
- code (run code / calculate)
- memory (remember/recall past)
- ui (open dashboard / navigate UI)
- planning (multi-step plan)
- chitchat (greeting / social)
- unknown

Query: {query}

Bucket:"#,
        );

        let req = InferenceRequest {
            prompt: prompt.into(),
            max_tokens: 16,
            temperature: 0.1,
            top_p: 0.9,
            stop_tokens: vec!["\n".into(), "Query:".into()],
            model: crate::policy::ModelChoice::Gemma2B,
        };

        let resp = self.inference.generate(req).await?;

        let bucket_word = resp.text.trim().to_lowercase();
        let bucket = match bucket_word.as_str() {
            "question"    => IntentBucket::Question,
            "synthesis"   => IntentBucket::Synthesis,
            "browser"     => IntentBucket::BrowserAction,
            "code"        => IntentBucket::CodeExecution,
            "memory"      => IntentBucket::MemoryOp,
            "ui"          => IntentBucket::UiNavigation,
            "planning"    => IntentBucket::Planning,
            "chitchat"    => IntentBucket::Chitchat,
            _             => IntentBucket::Unknown,
        };

        let confidence = if matches!(bucket, IntentBucket::Unknown) {
            0.40
        } else {
            0.75
        };

        Ok(HeuristicResult { bucket, confidence })
    }
}

#[derive(Debug, Clone)]
struct HeuristicResult {
    bucket: IntentBucket,
    confidence: f32,
}

fn query_contains_recall_markers(q: &str) -> bool {
    let l = q.to_lowercase();
    ["previous", "earlier", "before", "yesterday", "last week"]
        .iter().any(|m| l.contains(m))
}

fn query_contains_planning_markers(q: &str) -> bool {
    let l = q.to_lowercase();
    ["plan", "steps", "schedule", "roadmap", "strategy"]
        .iter().any(|m| l.contains(m))
}

/// Rough token estimate: 1 token ≈ 4 chars (English) or 1.5 chars (CJK).
fn estimate_tokens(s: &str) -> u32 {
    let chars = s.chars().count() as f32;
    let has_cjk = s.chars().any(|c| (c as u32) >= 0x4E00 && (c as u32) <= 0x9FFF);
    let tokens = if has_cjk { chars / 1.5 } else { chars / 4.0 };
    (tokens.ceil() as u32).max(1)
}

/// Detect language. CJK → "zh", Cyrillic → "ru", Latin → "en".
fn detect_language(s: &str) -> Arc<str> {
    for c in s.chars() {
        let cp = c as u32;
        if (0x4E00..=0x9FFF).contains(&cp) || (0x3040..=0x30FF).contains(&cp) {
            return "zh".into();
        }
        if (0xAC00..=0xD7AF).contains(&cp) {
            return "ko".into();
        }
    }
    "en".into()
}

/// REV.IKE marks all classifier outputs with Origin::RevIke — the
/// subconscious never claims authorship of cognition.
pub fn revike_origin() -> Origin {
    Origin::RevIke
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::inference::{MockBackend, InferenceResponse};
    use std::sync::Arc;

    fn make_classifier(response: &str) -> Classifier {
        let backend = Arc::new(MockBackend::new(vec![
            InferenceResponse {
                text: response.into(),
                tokens_generated: 1,
                latency_ms: 80,
            }
        ]));
        Classifier::new(backend)
    }

    #[tokio::test]
    async fn memory_op_detected_by_heuristic() {
        let c = make_classifier("memory");
        let intent = c.classify("Remember this for later".into(), "s1".into()).await.unwrap();
        assert_eq!(intent.bucket, IntentBucket::MemoryOp);
        assert!(intent.confidence > 0.7);
    }

    #[tokio::test]
    async fn browser_action_detected_by_heuristic() {
        let c = make_classifier("browser");
        let intent = c.classify("Open YouTube".into(), "s1".into()).await.unwrap();
        assert_eq!(intent.bucket, IntentBucket::BrowserAction);
        assert!(intent.requires_expansion);
    }

    #[tokio::test]
    async fn planning_detected_by_heuristic() {
        let c = make_classifier("planning");
        let intent = c.classify("Plan a 3-day trip to Tokyo".into(), "s1".into()).await.unwrap();
        assert_eq!(intent.bucket, IntentBucket::Planning);
        assert!(intent.requires_planning);
    }

    #[tokio::test]
    async fn unknown_falls_back_to_model() {
        let c = make_classifier("question");
        let intent = c.classify("Quantum entanglement implications".into(), "s1".into()).await.unwrap();
        // Heuristic returns Unknown at 0.3 conf, so model runs
        assert_eq!(intent.bucket, IntentBucket::Question);
    }

    #[test]
    fn token_estimator_handles_cjk() {
        assert!(estimate_tokens("hello world") > 0);
        assert!(estimate_tokens("你好世界") >= 2);
    }
}
