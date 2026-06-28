//! Router — executes a Decision by dispatching to the right Constellation agent.
//!
//! Each route has its own executor:
//!
//!   REV.IKE → run_revike()  — calls Gemma 2B with injected context, returns interpretation
//!   FABLE   → run_fable()   — calls Gemma 4 12B agentic, returns a plan
//!   GOOSE   → run_goose()   — dispatches to headless expansion service (AgentZero/Griptape/Bastani)
//!   TASHI   → run_tashi()   — memory compaction or recall (no inference)
//!   EPOCH   → run_epoch()   — UI render command (no inference)
//!   USER    → run_user()    — direct echo (acknowledgement, error message)
//!
//! Every executor returns a RouterResult containing the generated Receipt(s)
//! that should be deposited into the Context Ocean. The Orchestrator handles
//! the actual deposit — Router just produces the artifacts.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use tracing::{info, warn};

use lite_notebook::receipt::{Origin, Receipt, ReceiptKind};

use crate::budget::{BudgetDenialReason, BudgetReservation, BudgetTracker};
use crate::inference::{InferenceBackend, InferenceRequest, InferenceResponse};
use crate::injector::{InjectedContext, Injector};
use crate::policy::{ActionMode, Decision, ModelChoice, Route};

/// The result of executing a Decision.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RouterResult {
    /// Receipts produced by this turn (to be deposited in Context Ocean)
    pub receipts: Vec<Receipt>,

    /// The primary response text (to send back to the user / UI)
    pub response_text: Arc<str>,

    /// Which route handled this
    pub route: Route,

    /// Total wall-clock time spent in the router
    pub total_latency_ms: u32,

    /// Budget reservation (for release after deposit)
    pub budget_reservation: Option<BudgetReservation>,

    /// Whether the turn succeeded
    pub success: bool,

    /// Error message if !success
    pub error: Option<Arc<str>>,
}

pub struct Router {
    inference: Arc<dyn InferenceBackend>,
    injector: Arc<Injector>,
    budget: Arc<BudgetTracker>,
    /// Goose dispatch channel — sends expansion requests to headless services
    goose_tx: tokio::sync::mpsc::Sender<GooseRequest>,
    /// EPOCH render channel — sends UI commands
    epoch_tx: tokio::sync::broadcast::Sender<EpochCommand>,
}

impl Router {
    pub fn new(
        inference: Arc<dyn InferenceBackend>,
        injector: Arc<Injector>,
        budget: Arc<BudgetTracker>,
        goose_tx: tokio::sync::mpsc::Sender<GooseRequest>,
        epoch_tx: tokio::sync::broadcast::Sender<EpochCommand>,
    ) -> Arc<Self> {
        Arc::new(Self { inference, injector, budget, goose_tx, epoch_tx })
    }

    /// Execute a Decision. This is the entry point called by the Orchestrator.
    pub async fn execute(
        &self,
        decision: Decision,
        intent: &crate::policy::Intent,
        parent_receipt: Option<uuid::Uuid>,
    ) -> RouterResult {
        let start = std::time::Instant::now();

        // ── 1. Budget reservation ────────────────────────────────────
        let est_tokens = decision.generation_budget + decision.context_budget;
        let reservation = match self.budget.reserve(decision.model, est_tokens) {
            Ok(r) => Some(r),
            Err(reason) => {
                return self.budget_denied_response(decision.route, reason, start);
            }
        };

        // ── 2. Dispatch to route-specific executor ───────────────────
        let result = match decision.route {
            Route::RevIke => self.run_revike(&decision, intent, parent_receipt, reservation.as_ref().unwrap()).await,
            Route::Fable  => self.run_fable(&decision, intent, parent_receipt, reservation.as_ref().unwrap()).await,
            Route::Goose  => self.run_goose(&decision, intent, parent_receipt, reservation.as_ref().unwrap()).await,
            Route::Tashi  => self.run_tashi(&decision, intent, parent_receipt).await,
            Route::Epoch  => self.run_epoch(&decision, intent).await,
            Route::User   => self.run_user(&decision, intent).await,
            Route::Cortex => self.run_cortex(&decision, intent, parent_receipt, reservation.as_ref().unwrap()).await,
        };

        // ── 3. Release budget with actual usage ──────────────────────
        if let Some(res) = reservation {
            let actual = match &result {
                Ok(r) => r.receipts.iter()
                    .filter(|rc| rc.embedding.is_some())
                    .map(|_| 0u32) // TODO: read actual tokens from inference response
                    .next()
                    .unwrap_or(est_tokens),
                Err(_) => 0,
            };
            self.budget.release(res, actual);
        }

        match result {
            Ok(mut r) => {
                r.total_latency_ms = start.elapsed().as_millis() as u32;
                r
            }
            Err(e) => {
                warn!("route {:?} failed: {e}", decision.route);
                RouterResult {
                    receipts: vec![],
                    response_text: format!("Error: {e}").into(),
                    route: decision.route,
                    total_latency_ms: start.elapsed().as_millis() as u32,
                    budget_reservation: None,
                    success: false,
                    error: Some(e.to_string().into()),
                }
            }
        }
    }

    /// REV.IKE: lightweight interpretation via Gemma 2B with injected context.
    async fn run_revike(
        &self,
        decision: &Decision,
        intent: &crate::policy::Intent,
        parent_receipt: Option<uuid::Uuid>,
        _reservation: &BudgetReservation,
    ) -> anyhow::Result<RouterResult> {
        // 1. Inject context
        let injected = self.injector.inject(
            &intent.query,
            None, // no embedding for now (TODO: compute via Gemma 2B embedding endpoint)
            &intent.session_id,
            parent_receipt,
            decision.context_budget,
        ).await?;

        // 2. Build prompt
        let prompt = format!(
            "{prefix}You are REV.IKE, the user's subconscious interpreter. \
             Provide a concise, accurate response to the user's query.\n\n\
             User: {query}\n\n\
             REV.IKE:",
            prefix = injected.prompt_prefix,
            query = intent.query,
        );

        // 3. Call Gemma 2B
        let req = InferenceRequest {
            prompt: prompt.into(),
            max_tokens: decision.generation_budget,
            temperature: 0.4,
            top_p: 0.9,
            stop_tokens: vec!["User:".into(), "\n\n\n".into()],
            model: ModelChoice::Gemma2B,
        };
        let resp = self.inference.generate(req).await?;

        // 4. Build cognition Receipt
        let mut receipt = Receipt::new(
            intent.session_id.clone(),
            Origin::RevIke,
            ReceiptKind::Cognition,
            resp.text.clone(),
            parent_receipt,
        )
        .with_trust(0.7)
        .with_metadata("model", "gemma-2b")
        .with_metadata("latency_ms", resp.latency_ms.to_string())
        .with_metadata("tokens_generated", resp.tokens_generated.to_string())
        .with_metadata("strategies", format!("{:?}", injected.strategies_used));

        // Attach source receipt IDs as metadata
        for (i, sid) in injected.source_receipt_ids.iter().enumerate() {
            receipt = receipt.with_metadata(format!("src_{i}"), sid.to_string());
        }

        Ok(RouterResult {
            receipts: vec![receipt],
            response_text: resp.text,
            route: Route::RevIke,
            total_latency_ms: 0, // set by caller
            budget_reservation: None,
            success: true,
            error: None,
        })
    }

    /// FABLE: complex planning via Gemma 4 12B agentic.
    async fn run_fable(
        &self,
        decision: &Decision,
        intent: &crate::policy::Intent,
        parent_receipt: Option<uuid::Uuid>,
        _reservation: &BudgetReservation,
    ) -> anyhow::Result<RouterResult> {
        let injected = self.injector.inject(
            &intent.query,
            None,
            &intent.session_id,
            parent_receipt,
            decision.context_budget,
        ).await?;

        let prompt = format!(
            "{prefix}User request: {query}\n\n\
             Produce a step-by-step plan. Each step should be concrete and actionable.",
            prefix = injected.prompt_prefix,
            query = intent.query,
        );

        let req = InferenceRequest {
            prompt: prompt.into(),
            max_tokens: decision.generation_budget,
            temperature: 0.5,
            top_p: 0.95,
            stop_tokens: vec!["\n\n\n".into()],
            model: ModelChoice::Fable12B,
        };
        let resp = self.inference.generate(req).await?;

        let receipt = Receipt::new(
            intent.session_id.clone(),
            Origin::Fable,
            ReceiptKind::Cognition,
            resp.text.clone(),
            parent_receipt,
        )
        .with_trust(0.85)
        .with_metadata("model", "fable-12b")
        .with_metadata("latency_ms", resp.latency_ms.to_string())
        .with_metadata("tokens_generated", resp.tokens_generated.to_string());

        Ok(RouterResult {
            receipts: vec![receipt],
            response_text: resp.text,
            route: Route::Fable,
            total_latency_ms: 0,
            budget_reservation: None,
            success: true,
            error: None,
        })
    }

    /// GOOSE: dispatch to headless expansion service.
    async fn run_goose(
        &self,
        decision: &Decision,
        intent: &crate::policy::Intent,
        parent_receipt: Option<uuid::Uuid>,
        _reservation: &BudgetReservation,
    ) -> anyhow::Result<RouterResult> {
        let service = match intent.bucket {
            crate::policy::IntentBucket::BrowserAction => GooseService::AgentZero,
            crate::policy::IntentBucket::CodeExecution => GooseService::Griptape,
            crate::policy::IntentBucket::WhatsApp => GooseService::WhatsApp,
            _ => GooseService::AgentZero, // default
        };

        let request = GooseRequest {
            session_id: intent.session_id.clone(),
            query: intent.query.clone(),
            service,
            timeout_ms: decision.latency_budget_ms,
        };

        // Send to the goose dispatcher (non-blocking — we wait for response via oneshot)
        let (resp_tx, resp_rx) = tokio::sync::oneshot::channel();
        // We need to extend GooseRequest with a response channel — for now we just send
        // and rely on the orchestrator to broadcast receipts from the goose service.
        let request_with_resp = GooseRequestWithResp {
            inner: request,
            resp_tx: Some(resp_tx),
        };
        self.goose_tx.send(request_with_resp.inner).await
            .map_err(|_| anyhow::anyhow!("goose dispatcher closed"))?;

        // Wait for response with timeout
        let goose_result = tokio::time::timeout(
            std::time::Duration::from_millis(decision.latency_budget_ms as u64),
            resp_rx,
        ).await;

        let response_text = match goose_result {
            Ok(Ok(text)) => text,
            Ok(Err(_)) => "Goose service error".into(),
            Err(_) => "Goose service timeout".into(),
        };

        let receipt = Receipt::new(
            intent.session_id.clone(),
            Origin::Goose,
            ReceiptKind::Action,
            response_text.clone(),
            parent_receipt,
        )
        .with_trust(0.6)
        .with_metadata("service", service.as_str())
        .with_metadata("latency_budget_ms", decision.latency_budget_ms.to_string());

        Ok(RouterResult {
            receipts: vec![receipt],
            response_text,
            route: Route::Goose,
            total_latency_ms: 0,
            budget_reservation: None,
            success: true,
            error: None,
        })
    }

    /// TASHI: memory compaction or recall. No inference.
    async fn run_tashi(
        &self,
        _decision: &Decision,
        intent: &crate::policy::Intent,
        _parent_receipt: Option<uuid::Uuid>,
    ) -> anyhow::Result<RouterResult> {
        // TASHI is handled structurally — the Injector already pulled memories.
        // We just acknowledge.
        let receipt = Receipt::new(
            intent.session_id.clone(),
            Origin::Tashi,
            ReceiptKind::Memory,
            "memory_op_ack".into(),
            None,
        ).with_trust(0.9);

        Ok(RouterResult {
            receipts: vec![receipt],
            response_text: "Memory operation completed.".into(),
            route: Route::Tashi,
            total_latency_ms: 0,
            budget_reservation: None,
            success: true,
            error: None,
        })
    }

    /// EPOCH: UI render command. No inference.
    async fn run_epoch(
        &self,
        _decision: &Decision,
        intent: &crate::policy::Intent,
    ) -> anyhow::Result<RouterResult> {
        let cmd = EpochCommand {
            session_id: intent.session_id.clone(),
            target: parse_ui_target(&intent.query),
            payload: intent.query.clone(),
        };
        let _ = self.epoch_tx.send(cmd);

        Ok(RouterResult {
            receipts: vec![],
            response_text: "UI update dispatched.".into(),
            route: Route::Epoch,
            total_latency_ms: 0,
            budget_reservation: None,
            success: true,
            error: None,
        })
    }

    /// USER: direct echo (acknowledgements, errors).
    async fn run_user(
        &self,
        _decision: &Decision,
        intent: &crate::policy::Intent,
    ) -> anyhow::Result<RouterResult> {
        Ok(RouterResult {
            receipts: vec![],
            response_text: intent.query.clone(),
            route: Route::User,
            total_latency_ms: 0,
            budget_reservation: None,
            success: true,
            error: None,
        })
    }

    /// CORTEX: deep reasoning via Mercury2 diffusion (L6 Cortex tier).
    async fn run_cortex(
        &self,
        decision: &Decision,
        intent: &crate::policy::Intent,
        parent_receipt: Option<uuid::Uuid>,
        _reservation: &BudgetReservation,
    ) -> anyhow::Result<RouterResult> {
        let injected = self.injector.inject(
            &intent.query, None, &intent.session_id, parent_receipt, decision.context_budget,
        ).await?;

        let cortex_prompt = format!(
            "{prefix}You are the CORTEX tier of AVA007. Use deep reasoning.\n\n             ESCALATION: REV.IKE + FABLE could not resolve intent {bucket:?} (conf {conf:.2}).\n\n             USER QUERY: {query}\n\n             Provide a thorough, well-reasoned response:",
            prefix = injected.prompt_prefix,
            bucket = intent.bucket,
            conf = intent.confidence,
            query = intent.query,
        );

        let req = InferenceRequest {
            prompt: cortex_prompt.into(),
            max_tokens: decision.generation_budget,
            temperature: 0.7,
            top_p: 0.95,
            stop_tokens: vec!["\n\n\n".into()],
            model: ModelChoice::Mercury2,
        };
        let resp = self.inference.generate(req).await?;

        let receipt = Receipt::new(
            intent.session_id.clone(),
            lite_notebook::Origin::Fable,
            lite_notebook::ReceiptKind::Cognition,
            resp.text.clone(),
            parent_receipt,
        )
        .with_trust(0.85)
        .with_metadata("model", "mercury-2")
        .with_metadata("tier", "cortex")
        .with_metadata("latency_ms", resp.latency_ms.to_string())
        .with_metadata("tokens_generated", resp.tokens_generated.to_string());

        Ok(RouterResult {
            receipts: vec![receipt],
            response_text: resp.text,
            route: Route::Cortex,
            total_latency_ms: 0,
            budget_reservation: None,
            success: true,
            error: None,
        })
    }

    fn budget_denied_response(
        &self,
        route: Route,
        reason: BudgetDenialReason,
        start: std::time::Instant,
    ) -> RouterResult {
        let msg = match reason {
            BudgetDenialReason::SessionTokenBudgetExhausted =>
                "Session token budget exhausted. Please start a new session.",
            BudgetDenialReason::SessionDurationExceeded =>
                "Session duration limit reached. Please start a new session.",
            BudgetDenialReason::FableConcurrentLimit =>
                "FABLE is busy with another request. Please wait.",
            BudgetDenialReason::FableRateLimited =>
                "FABLE rate limit hit. Please wait a minute.",
            BudgetDenialReason::GemmaThroughputCap =>
                "Gemma throughput cap hit. Slowing down.",
            BudgetDenialReason::ThermalThrottling =>
                "Device is warm. Heavy inference temporarily disabled.",
            BudgetDenialReason::ThermalCritical =>
                "Device is too hot. Please let it cool down.",
            BudgetDenialReason::Allowed => "OK",
        };

        RouterResult {
            receipts: vec![],
            response_text: msg.into(),
            route,
            total_latency_ms: start.elapsed().as_millis() as u32,
            budget_reservation: None,
            success: false,
            error: Some(reason.as_str().into()),
        }
    }
}

// ── Goose expansion services ────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum GooseService {
    AgentZero,   // Browser automation
    Griptape,    // Python orchestration
    Bastani,     // Autonomous engineering
    WhatsApp,    // Telnyx WhatsApp messaging + calling (Knox-safe cloud API)
}

impl GooseService {
    pub fn as_str(self) -> &'static str {
        match self {
            GooseService::AgentZero => "agentzero",
            GooseService::Griptape => "griptape",
            GooseService::Bastani  => "bastani",
            GooseService::WhatsApp => "whatsapp",
        }
    }
}

#[derive(Debug, Clone)]
pub struct GooseRequest {
    pub session_id: Arc<str>,
    pub query: Arc<str>,
    pub service: GooseService,
    pub timeout_ms: u32,
}

struct GooseRequestWithResp {
    inner: GooseRequest,
    resp_tx: Option<tokio::sync::oneshot::Sender<Arc<str>>>,
}

// ── EPOCH UI commands ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EpochCommand {
    pub session_id: Arc<str>,
    pub target: UiTarget,
    pub payload: Arc<str>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum UiTarget {
    Home,
    Dashboard,
    Notebook,
    Settings,
    Search,
    Custom,
}

fn parse_ui_target(query: &str) -> UiTarget {
    let q = query.to_lowercase();
    if q.contains("dashboard") { UiTarget::Dashboard }
    else if q.contains("notebook") { UiTarget::Notebook }
    else if q.contains("settings") { UiTarget::Settings }
    else if q.contains("search") { UiTarget::Search }
    else if q.contains("home") { UiTarget::Home }
    else { UiTarget::Custom }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::inference::MockBackend;
    use crate::injector::{ContextLake, Injector};
    use crate::budget::BudgetTracker;
    use lite_notebook::receipt::{Origin, ReceiptKind, Receipt};
    use async_trait::async_trait;
    use uuid::Uuid;

    struct MockLake;
    #[async_trait]
    impl ContextLake for MockLake {
        async fn recall_similar(&self, _e: &[f32], _k: usize) -> anyhow::Result<Vec<Receipt>> { Ok(vec![]) }
        async fn session_recent(&self, _s: &str, _n: usize) -> anyhow::Result<Vec<Receipt>> { Ok(vec![]) }
        async fn lineage_chain(&self, _id: Uuid) -> anyhow::Result<Vec<Receipt>> { Ok(vec![]) }
        async fn user_memories(&self, _l: usize) -> anyhow::Result<Vec<Receipt>> { Ok(vec![]) }
    }

    #[tokio::test]
    async fn revike_route_produces_cognition_receipt() {
        let backend = Arc::new(MockBackend::new(vec![
            crate::inference::InferenceResponse {
                text: "Photosynthesis is how plants make food.".into(),
                tokens_generated: 12,
                latency_ms: 250,
            }
        ]));
        let lake = Arc::new(MockLake);
        let injector = Arc::new(Injector::new(lake, 16));
        let budget = BudgetTracker::new();
        let (goose_tx, _goose_rx) = tokio::sync::mpsc::channel(8);
        let (epoch_tx, _epoch_rx) = tokio::sync::broadcast::channel(8);

        let router = Router::new(backend, injector, budget, goose_tx, epoch_tx);

        let intent = crate::policy::Intent {
            query: "What is photosynthesis?".into(),
            bucket: crate::policy::IntentBucket::Question,
            confidence: 0.85,
            language: "en".into(),
            estimated_tokens: 5,
            requires_expansion: false,
            requires_recall: true,
            requires_planning: false,
            session_id: "test".into(),
        };

        let decision = crate::policy::decide(&intent);
        let result = router.execute(decision, &intent, None).await;

        assert!(result.success);
        assert_eq!(result.route, Route::RevIke);
        assert_eq!(result.receipts.len(), 1);
        assert_eq!(result.receipts[0].origin, Origin::RevIke);
        assert_eq!(result.receipts[0].kind, ReceiptKind::Cognition);
        assert!(result.response_text.contains("Photosynthesis"));
    }
}
