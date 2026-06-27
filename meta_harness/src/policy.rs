//! Decision Policy — the Injection vs Expansion matrix.
//!
//! This is THE golden rule of AVA007 encoded as executable code:
//!
//!   INJECT  intelligence when the answer already exists in the Context Ocean
//!           or can be derived by the Runtime Brain (Gemma 2B) with retrieved
//!           context. No side-effects. Sub-millisecond. Always preferred.
//!
//!   EXPAND  only when the task requires action in the external world
//!           (browser automation, desktop control, complex Python workflows,
//!           autonomous engineering loops). Headless services under goose/.
//!           Seconds-to-minutes. Never the default.
//!
//! The policy is consulted by the Router AFTER the Classifier has produced
//! an Intent. It returns a Decision: which agent, which model, inject or
//! expand, and what context to retrieve first.

use std::sync::Arc;

use serde::{Deserialize, Serialize};

use lite_notebook::receipt::{Origin, ReceiptKind};

/// Top-level Constellation route. Every Receipt flows through exactly one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[repr(u8)]
pub enum Route {
    /// Read-only subconscious. Fast interpretation, pattern matching,
    /// sentiment, intent classification. Never produces Actions.
    RevIke = 0,

    /// Planning agent (Gemma 4 12B agentic). Complex multi-step reasoning,
    /// tool-use planning, decomposition. Loaded on-demand.
    Fable = 1,

    /// Expansion services. Browser (AgentZero), Python (Griptape),
    /// autonomous engineering (Bastani). Headless, slow, side-effectful.
    Goose = 2,

    /// Memory compaction. Summarizes old sessions into Memory Receipts.
    /// Runs in the background, never on the critical path.
    Tashi = 3,

    /// UI sandbox render. Arrow consumer. The Meta Harness routes here
    /// when the user's intent is "show me" / "display" / "open".
    Epoch = 4,

    /// Direct user echo (acknowledgement, "thinking...", error messages).
    /// Bypasses inference entirely.
    User = 5,
}

impl Route {
    pub fn origin(self) -> Origin {
        match self {
            Route::RevIke => Origin::RevIke,
            Route::Fable  => Origin::Fable,
            Route::Goose  => Origin::Goose,
            Route::Tashi  => Origin::Tashi,
            Route::Epoch  => Origin::Epoch,
            Route::User   => Origin::User,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Route::RevIke => "REV.IKE",
            Route::Fable  => "FABLE",
            Route::Goose  => "GOOSE",
            Route::Tashi  => "TASHI",
            Route::Epoch  => "EPOCH",
            Route::User   => "USER",
        }
    }
}

/// What the Runtime Brain should do with the routed intent.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ActionMode {
    /// Pull context from Context Ocean, run inference, return answer.
    /// No external side-effects. Default for 90%+ of requests.
    Inject,

    /// Hand off to a headless expansion service under goose/.
    /// Meta Harness waits for completion (or streams progress).
    Expand,

    /// Hybrid: inject context first, then expand with that context loaded.
    /// Used for "research X and then write a report" patterns.
    InjectThenExpand,

    /// Memory operation — compact, recall, or forget. TASHI-only.
    Memorize,

    /// Pure UI render — no inference. EPOCH-only.
    Render,
}

/// Intent classification produced by the Classifier (REV.IKE fast path).
/// Drives the policy decision.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Intent {
    /// Raw user input text
    pub query: Arc<str>,

    /// Coarse intent bucket
    pub bucket: IntentBucket,

    /// Confidence [0.0, 1.0] from the classifier
    pub confidence: f32,

    /// Detected language code (ISO 639-1, e.g. "en", "zh", "es")
    pub language: Arc<str>,

    /// Estimated tokens in the query (for budgeting)
    pub estimated_tokens: u32,

    /// Whether the query mentions external tools/apps/browser
    pub requires_expansion: bool,

    /// Whether the query is a recall request ("what did I say about...")
    pub requires_recall: bool,

    /// Whether the query is a planning request ("plan", "steps", "how do I")
    pub requires_planning: bool,

    /// Session ID this intent belongs to
    pub session_id: Arc<str>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum IntentBucket {
    /// "What is X", "Explain Y" — factual recall
    Question,
    /// "Summarize", "Compare", "Analyze" — synthesis over Context Ocean
    Synthesis,
    /// "Open YouTube", "Search for X on Amazon" — browser action
    BrowserAction,
    /// "Run this Python", "Calculate X" — code execution
    CodeExecution,
    /// "Remember that...", "What did I say about..." — memory ops
    MemoryOp,
    /// "Show me my feed", "Open the dashboard" — UI navigation
    UiNavigation,
    /// "Plan a trip", "Design a system" — multi-step planning
    Planning,
    /// "Send WhatsApp message to X", "Enable WhatsApp calling"
    /// — Telnyx WhatsApp messaging + calling (cloud API, Knox-safe)
    WhatsApp,
    /// "Hello", "Thanks", "Are you there?" — social/conversational
    Chitchat,
    /// Fallback
    Unknown,
}

/// The full decision produced by the policy.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Decision {
    /// Which Constellation agent handles this
    pub route: Route,

    /// What action mode to use
    pub mode: ActionMode,

    /// Which model to use for inference (if any)
    pub model: ModelChoice,

    /// How many context receipts to inject before inference
    pub context_budget: u32,

    /// Maximum tokens the model is allowed to generate
    pub generation_budget: u32,

    /// Maximum wall-clock milliseconds for this turn
    pub latency_budget_ms: u32,

    /// Whether to broadcast the result to the UI (EPOCH)
    pub broadcast_to_ui: bool,

    /// Whether this decision requires REV.IKE pre-interpretation
    pub requires_revike_pre: bool,

    /// Free-form rationale (for audit trail)
    pub rationale: Arc<str>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ModelChoice {
    /// Gemma 2B via llama-server (port 8080). ~27 tok/s on S25 Ultra.
    /// Default for fast cognition.
    Gemma2B,

    /// FABLE — Gemma 4 12B agentic finetune. Loaded on-demand.
    /// ~7 tok/s. Used only for Planning intents.
    Fable12B,

    /// No model needed (UI navigation, memory ops handled structurally)
    None,
}

/// The policy function. Pure, deterministic, side-effect-free.
/// Same Intent → same Decision. This makes the Meta Harness auditable.
pub fn decide(intent: &Intent) -> Decision {
    use IntentBucket::*;
    use ActionMode::*;

    // ── Default budgets ─────────────────────────────────────────────
    let mut route = Route::RevIke;
    let mut mode = Inject;
    let mut model = ModelChoice::Gemma2B;
    let mut context_budget = 8u32;       // 8 receipts by default
    let mut generation_budget = 512u32;
    let mut latency_budget_ms = 4000u32;
    let mut broadcast_to_ui = true;
    let mut requires_revike_pre = true;   // always pre-interpret
    let mut rationale: Arc<str> = "default".into();

    match intent.bucket {
        Question => {
            route = Route::RevIke;
            mode = Inject;
            model = ModelChoice::Gemma2B;
            context_budget = 12;
            generation_budget = 384;
            latency_budget_ms = 3000;
            rationale = "question → REV.IKE injects Context Ocean + Gemma 2B".into();
        }
        Synthesis => {
            route = Route::RevIke;
            mode = Inject;
            model = ModelChoice::Gemma2B;
            context_budget = 24;  // need more context for synthesis
            generation_budget = 768;
            latency_budget_ms = 5000;
            rationale = "synthesis → REV.IKE with expanded context window".into();
        }
        BrowserAction => {
            route = Route::Goose;
            mode = Expand;
            model = ModelChoice::Gemma2B;  // Goose uses Gemma for sub-routing
            context_budget = 4;
            generation_budget = 256;
            latency_budget_ms = 30_000;  // browser is slow
            requires_revike_pre = true;
            rationale = "browser action → GOOSE expansion (AgentZero)".into();
        }
        CodeExecution => {
            route = Route::Goose;
            mode = Expand;
            model = ModelChoice::Gemma2B;  // Griptape uses Gemma for code gen
            context_budget = 6;
            generation_budget = 1024;
            latency_budget_ms = 60_000;
            rationale = "code execution → GOOSE expansion (Griptape)".into();
        }
        MemoryOp => {
            route = Route::Tashi;
            mode = Memorize;
            model = ModelChoice::None;
            context_budget = 32;  // need full session context
            generation_budget = 0;
            latency_budget_ms = 2000;
            requires_revike_pre = false;
            rationale = "memory op → TASHI direct (no inference)".into();
        }
        UiNavigation => {
            route = Route::Epoch;
            mode = Render;
            model = ModelChoice::None;
            context_budget = 0;
            generation_budget = 0;
            latency_budget_ms = 500;
            requires_revike_pre = false;
            rationale = "UI nav → EPOCH direct render (no inference)".into();
        }
        Planning => {
            route = Route::Fable;
            mode = Inject;
            model = ModelChoice::Fable12B;  // escalate to 12B
            context_budget = 32;
            generation_budget = 2048;
            latency_budget_ms = 20_000;  // FABLE is slow
            requires_revike_pre = true;
            rationale = "planning → FABLE 12B with deep context injection".into();
        }
        Chitchat => {
            route = Route::RevIke;
            mode = Inject;
            model = ModelChoice::Gemma2B;
            context_budget = 4;
            generation_budget = 128;
            latency_budget_ms = 1500;
            rationale = "chitchat → REV.IKE minimal context, fast Gemma".into();
        }
        WhatsApp => {
            // Cloud telephony API — Knox-safe because we're calling Telnyx,
            // NOT touching the device's own telephony stack.
            route = Route::Goose;
            mode = Expand;
            model = ModelChoice::Gemma2B;  // Goose uses Gemma to compose the message
            context_budget = 6;
            generation_budget = 512;  // message body can be long
            latency_budget_ms = 15_000;  // Telnyx API round-trip
            requires_revike_pre = true;
            rationale = "whatsapp action → GOOSE expansion (Telnyx WhatsApp API, Knox-safe cloud call)".into();
        }
        Unknown => {
            route = Route::RevIke;
            mode = Inject;
            model = ModelChoice::Gemma2B;
            context_budget = 8;
            generation_budget = 256;
            latency_budget_ms = 2500;
            rationale = "unknown → conservative default (REV.IKE + Gemma 2B)".into();
        }
    }

    // ── Confidence-based overrides ──────────────────────────────────
    if intent.confidence < 0.4 && route != Route::Fable {
        // Low-confidence non-planning intent → escalate to FABLE for careful reasoning
        rationale = format!(
            "{rationale} | low confidence ({:.2}) → FABLE escalation",
            intent.confidence
        ).into();
        route = Route::Fable;
        model = ModelChoice::Fable12B;
        latency_budget_ms = latency_budget_ms.max(15_000);
    }

    // ── Knox safety override ────────────────────────────────────────
    // If the query mentions telephony/modem/IMEI/root, force REV.IKE
    // read-only and refuse expansion. Knox must stay intact.
    if is_knox_sensitive(&intent.query) {
        rationale = format!(
            "{rationale} | KNOX-SENSITIVE → REV.IKE read-only, expansion refused"
        ).into();
        route = Route::RevIke;
        mode = Inject;
        model = ModelChoice::Gemma2B;
        broadcast_to_ui = true;  // user must see this was blocked
    }

    Decision {
        route,
        mode,
        model,
        context_budget,
        generation_budget,
        latency_budget_ms,
        broadcast_to_ui,
        requires_revike_pre,
        rationale,
    }
}

/// Detect Knox-sensitive queries.
///
/// IMPORTANT: The Knox invariant protects the DEVICE'S OWN telephony stack
/// (modem, SIM, IMEI, EFS partition, carrier lock). It does NOT block cloud
/// telephony APIs (Telnyx, Twilio, Plivo) — those are just HTTPS calls to
/// remote services and never touch device hardware.
///
/// So this filter catches:
///   - "unlock the SIM" (device carrier unlock → Knox void)
///   - "show me my IMEI" (device hardware identifier)
///   - "root the phone" (Knox trip)
///   - "intercept calls" (device-side telephony attack)
///
/// It does NOT catch:
///   - "send a WhatsApp message" (cloud API — Knox-safe)
///   - "enable WhatsApp calling on my Telnyx number" (cloud API — Knox-safe)
///   - "forward calls to my Twilio number" (cloud API — Knox-safe)
fn is_knox_sensitive(query: &str) -> bool {
    // These keywords all refer to DEVICE-SIDE telephony manipulation.
    // Cloud telephony APIs (Telnyx, Twilio) are NOT here because they
    // don't touch the device's Knox-protected surfaces.
    const DEVICE_TELEPHONY_KEYWORDS: &[&str] = &[
        // Device hardware identifiers
        "imei", "imsi", "device id",
        // Device carrier unlock (voids Knox)
        "sim unlock", "carrier unlock",
        "unlock sim", "unlock the sim",
        "unlock carrier", "unlock the carrier",
        "sim carrier", "carrier sim",
        // Device root / Knox trip
        "root access", "magisk", "knox tripped", "knox void",
        "trip knox", "void knox",
        // Device modem / baseband / EFS
        "modem firmware", "baseband", "efs partition",
        // Device-side telephony attacks (require root)
        "call intercept", "sms intercept",
        "telephony exploit",
    ];
    let q = query.to_lowercase();
    DEVICE_TELEPHONY_KEYWORDS.iter().any(|k| q.contains(k))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_intent(bucket: IntentBucket, query: &str) -> Intent {
        Intent {
            query: query.into(),
            bucket,
            confidence: 0.85,
            language: "en".into(),
            estimated_tokens: 20,
            requires_expansion: false,
            requires_recall: false,
            requires_planning: false,
            session_id: "test".into(),
        }
    }

    #[test]
    fn question_routes_to_revike_inject() {
        let d = decide(&make_intent(IntentBucket::Question, "What is photosynthesis?"));
        assert_eq!(d.route, Route::RevIke);
        assert_eq!(d.mode, ActionMode::Inject);
        assert_eq!(d.model, ModelChoice::Gemma2B);
    }

    #[test]
    fn browser_routes_to_goose_expand() {
        let d = decide(&make_intent(IntentBucket::BrowserAction, "Open YouTube"));
        assert_eq!(d.route, Route::Goose);
        assert_eq!(d.mode, ActionMode::Expand);
    }

    #[test]
    fn planning_escalates_to_fable_12b() {
        let d = decide(&make_intent(IntentBucket::Planning, "Plan a 3-day trip to Tokyo"));
        assert_eq!(d.route, Route::Fable);
        assert_eq!(d.model, ModelChoice::Fable12B);
        assert!(d.latency_budget_ms >= 15_000);
    }

    #[test]
    fn knox_sensitive_forces_revike_readonly() {
        let d = decide(&make_intent(
            IntentBucket::BrowserAction,
            "Show me how to unlock the SIM carrier",
        ));
        assert_eq!(d.route, Route::RevIke);
        assert_eq!(d.mode, ActionMode::Inject);
        assert!(d.rationale.contains("KNOX-SENSITIVE"));
    }

    #[test]
    fn low_confidence_escalates_to_fable() {
        let mut intent = make_intent(IntentBucket::Question, "huh?");
        intent.confidence = 0.2;
        let d = decide(&intent);
        assert_eq!(d.route, Route::Fable);
    }

    #[test]
    fn memory_op_bypasses_inference() {
        let d = decide(&make_intent(IntentBucket::MemoryOp, "Remember this"));
        assert_eq!(d.route, Route::Tashi);
        assert_eq!(d.model, ModelChoice::None);
        assert_eq!(d.mode, ActionMode::Memorize);
    }
}
