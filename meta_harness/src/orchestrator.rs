//! Meta Harness Orchestrator — the main cognitive loop.
//!
//! This is the AVA007 executive. It owns the pipeline:
//!
//!   User Input
//!       │
//!       ▼
//!   ┌─────────────────────────────────────────────────────────┐
//!   │  1. Classify  (REV.IKE heuristics + Gemma 2B fallback)  │
//!   │  2. Decide    (policy::decide → Decision)               │
//!   │  3. Reserve   (budget::reserve → BudgetReservation)     │
//!   │  4. Inject    (Context Lake → InjectedContext)          │
//!   │  5. Route     (Router::execute → RouterResult)          │
//!   │  6. Deposit   (Receipts → Lite Notebook → Ocean)        │
//!   │  7. Broadcast (response to UI + REV.IKE feed)           │
//!   │  8. Audit     (emit TurnReceipt for every step)         │
//!   └─────────────────────────────────────────────────────────┘
//!
//! Each step emits a Receipt, so the entire pipeline is auditable in
//! the Context Ocean. The user can ask "how did AVA007 arrive at this
//! answer?" and trace the full lineage via the parent_receipt DAG.

use std::sync::Arc;
use std::time::Instant;

use serde::{Deserialize, Serialize};
use tokio::sync::{broadcast, mpsc, RwLock};
use tracing::{error, info, warn};

use lite_notebook::receipt::{Origin, Receipt, ReceiptKind};
use lite_notebook::ocean::ContextOcean;

use crate::budget::BudgetTracker;
use crate::classifier::Classifier;
use crate::inference::InferenceBackend;
use crate::injector::Injector;
use crate::policy::{Decision, Intent};
use crate::router::{Router, RouterResult};

/// The Meta Harness handle. Clonable, owns nothing mutable.
#[derive(Clone)]
pub struct MetaHarness {
    classifier: Arc<Classifier>,
    router: Arc<Router>,
    budget: Arc<BudgetTracker>,
    ocean: ContextOcean,
    /// Broadcast channel for UI updates (response text + receipts)
    ui_tx: broadcast::Sender<TurnUpdate>,
    /// Last decision (for debugging / introspection)
    last_decision: Arc<RwLock<Option<Decision>>>,
    /// Last intent (for debugging / introspection)
    last_intent: Arc<RwLock<Option<Intent>>>,
}

/// Live update broadcast to UI subscribers (EPOCH).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TurnUpdate {
    pub session_id: Arc<str>,
    pub phase: TurnPhase,
    pub message: Arc<str>,
    pub timestamp_ns: i64,
    pub decision: Option<Decision>,
    pub response_text: Option<Arc<str>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TurnPhase {
    Classifying,
    Deciding,
    Injecting,
    Routing,
    Depositing,
    Complete,
    Error,
}

/// The final result of processing one user turn.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TurnResult {
    pub response_text: Arc<str>,
    pub route: crate::policy::Route,
    pub latency_ms: u32,
    pub success: bool,
    pub receipts_emitted: u32,
    pub decision: Decision,
}

impl MetaHarness {
    /// Bootstrap the Meta Harness.
    /// Wires together: classifier, router, budget, injector, ocean.
    pub fn new(
        inference: Arc<dyn InferenceBackend>,
        injector: Arc<Injector>,
        ocean: ContextOcean,
        goose_tx: mpsc::Sender<crate::router::GooseRequest>,
        ui_broadcast_capacity: usize,
    ) -> Arc<Self> {
        let budget = BudgetTracker::new();
        let classifier = Arc::new(Classifier::new(inference.clone()));
        let (epoch_tx, _) = broadcast::channel(32);
        let router = Router::new(
            inference,
            injector,
            budget.clone(),
            goose_tx,
            epoch_tx,
        );
        let (ui_tx, _) = broadcast::channel(ui_broadcast_capacity);

        Arc::new(Self {
            classifier,
            router,
            budget,
            ocean,
            ui_tx,
            last_decision: Arc::new(RwLock::new(None)),
            last_intent: Arc::new(RwLock::new(None)),
        })
    }

    /// Process a single user turn. This is THE entry point.
    ///
    /// 1. Deposit the user's perception Receipt into Context Ocean
    /// 2. Classify the intent
    /// 3. Decide the routing
    /// 4. Execute via the Router
    /// 5. Deposit any generated Receipts
    /// 6. Broadcast the response to the UI
    pub async fn turn(
        &self,
        user_input: Arc<str>,
        session_id: Arc<str>,
    ) -> anyhow::Result<TurnResult> {
        let turn_start = Instant::now();
        let timestamp_ns = now_ns();

        // ── 1. Deposit user perception ───────────────────────────────
        let perception = Receipt::new(
            session_id.clone(),
            Origin::User,
            ReceiptKind::Perception,
            user_input.clone(),
            None,
        ).with_trust(1.0);

        let parent_receipt_id = perception.id;
        self.ocean.deposit(perception).await?;

        self.broadcast(TurnUpdate {
            session_id: session_id.clone(),
            phase: TurnPhase::Classifying,
            message: "Classifying intent…".into(),
            timestamp_ns,
            decision: None,
            response_text: None,
        }).await;

        // ── 2. Classify ───────────────────────────────────────────────
        let intent = match self.classifier.classify(
            user_input.clone(),
            session_id.clone(),
        ).await {
            Ok(i) => i,
            Err(e) => {
                error!("classification failed: {e}");
                return self.fail_turn(session_id, user_input, e.to_string()).await;
            }
        };

        info!("classified: bucket={:?} conf={:.2}", intent.bucket, intent.confidence);
        *self.last_intent.write().await = Some(intent.clone());

        self.broadcast(TurnUpdate {
            session_id: session_id.clone(),
            phase: TurnPhase::Deciding,
            message: format!("Deciding route for {:?}…", intent.bucket).into(),
            timestamp_ns,
            decision: None,
            response_text: None,
        }).await;

        // ── 3. Decide ─────────────────────────────────────────────────
        let decision = crate::policy::decide(&intent);
        *self.last_decision.write().await = Some(decision.clone());

        info!(
            "decision: route={:?} mode={:?} model={:?} rationale={}",
            decision.route,
            std::mem::discriminant(&decision.mode),
            decision.model,
            decision.rationale
        );

        self.broadcast(TurnUpdate {
            session_id: session_id.clone(),
            phase: TurnPhase::Injecting,
            message: format!("Injecting {} receipts…", decision.context_budget).into(),
            timestamp_ns,
            decision: Some(decision.clone()),
            response_text: None,
        }).await;

        // ── 4. Route + Execute ────────────────────────────────────────
        self.broadcast(TurnUpdate {
            session_id: session_id.clone(),
            phase: TurnPhase::Routing,
            message: format!("Routing to {}…", decision.route.as_str()).into(),
            timestamp_ns,
            decision: Some(decision.clone()),
            response_text: None,
        }).await;

        let result: RouterResult = self.router.execute(
            decision.clone(),
            &intent,
            Some(parent_receipt_id),
        ).await;

        if !result.success {
            warn!("turn failed at route {:?}: {:?}", result.route, result.error);
            self.broadcast(TurnUpdate {
                session_id: session_id.clone(),
                phase: TurnPhase::Error,
                message: result.response_text.clone(),
                timestamp_ns: now_ns(),
                decision: Some(decision.clone()),
                response_text: Some(result.response_text.clone()),
            }).await;

            return Ok(TurnResult {
                response_text: result.response_text,
                route: result.route,
                latency_ms: turn_start.elapsed().as_millis() as u32,
                success: false,
                receipts_emitted: 0,
                decision,
            });
        }

        // ── 5. Deposit generated Receipts ────────────────────────────
        self.broadcast(TurnUpdate {
            session_id: session_id.clone(),
            phase: TurnPhase::Depositing,
            message: format!("Depositing {} receipts…", result.receipts.len()).into(),
            timestamp_ns: now_ns(),
            decision: Some(decision.clone()),
            response_text: None,
        }).await;

        for receipt in &result.receipts {
            if let Err(e) = self.ocean.deposit(receipt.clone()).await {
                error!("failed to deposit receipt: {e}");
            }
        }

        // ── 6. Broadcast completion ──────────────────────────────────
        let turn_result = TurnResult {
            response_text: result.response_text.clone(),
            route: result.route,
            latency_ms: turn_start.elapsed().as_millis() as u32,
            success: true,
            receipts_emitted: result.receipts.len() as u32,
            decision: decision.clone(),
        };

        self.broadcast(TurnUpdate {
            session_id: session_id.clone(),
            phase: TurnPhase::Complete,
            message: "Done.".into(),
            timestamp_ns: now_ns(),
            decision: Some(decision.clone()),
            response_text: Some(result.response_text.clone()),
        }).await;

        info!(
            "turn complete: route={:?} latency={}ms receipts={}",
            turn_result.route, turn_result.latency_ms, turn_result.receipts_emitted
        );

        Ok(turn_result)
    }

    /// Subscribe to live UI updates (EPOCH).
    pub fn subscribe(&self) -> broadcast::Receiver<TurnUpdate> {
        self.ui_tx.subscribe()
    }

    /// Snapshot the budget state (for UI display).
    pub fn budget_snapshot(&self) -> crate::budget::BudgetSnapshot {
        self.budget.snapshot()
    }

    /// Reset the session budget (called when AVA007 starts a new session).
    pub fn reset_session(&self) {
        self.budget.reset_session();
    }

    /// Update thermal state (called by external thermal monitor).
    pub fn update_thermal(&self, temp_c: u32) {
        self.budget.update_thermal(temp_c);
    }

    async fn broadcast(&self, update: TurnUpdate) {
        // Non-blocking — if subscribers are slow, they drop
        let _ = self.ui_tx.send(update);
    }

    async fn fail_turn(
        &self,
        session_id: Arc<str>,
        _user_input: Arc<str>,
        error: String,
    ) -> anyhow::Result<TurnResult> {
        self.broadcast(TurnUpdate {
            session_id: session_id.clone(),
            phase: TurnPhase::Error,
            message: format!("Error: {error}").into(),
            timestamp_ns: now_ns(),
            decision: None,
            response_text: Some(format!("Error: {error}").into()),
        }).await;

        Ok(TurnResult {
            response_text: format!("Error: {error}").into(),
            route: crate::policy::Route::User,
            latency_ms: 0,
            success: false,
            receipts_emitted: 0,
            decision: crate::policy::decide(&crate::policy::Intent {
                query: "".into(),
                bucket: crate::policy::IntentBucket::Unknown,
                confidence: 0.0,
                language: "en".into(),
                estimated_tokens: 0,
                requires_expansion: false,
                requires_recall: false,
                requires_planning: false,
                session_id,
            }),
        })
    }
}

fn now_ns() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::inference::{InferenceResponse, MockBackend};
    use crate::injector::{ContextLake, Injector};
    use lite_notebook::receipt::Receipt;
    use uuid::Uuid;

    struct MockLake;
    #[async_trait::async_trait]
    impl ContextLake for MockLake {
        async fn recall_similar(&self, _e: &[f32], _k: usize) -> anyhow::Result<Vec<Receipt>> { Ok(vec![]) }
        async fn session_recent(&self, _s: &str, _n: usize) -> anyhow::Result<Vec<Receipt>> { Ok(vec![]) }
        async fn lineage_chain(&self, _id: Uuid) -> anyhow::Result<Vec<Receipt>> { Ok(vec![]) }
        async fn user_memories(&self, _l: usize) -> anyhow::Result<Vec<Receipt>> { Ok(vec![]) }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn end_to_end_question_turn() {
        let dir = tempfile::tempdir().unwrap();
        let ocean_cfg = lite_notebook::ocean::OceanConfig {
            base_path: dir.path().to_path_buf(),
            flush_channel_capacity: 8,
            broadcast_capacity: 16,
            max_commit_retries: 2,
        };
        let (ocean, _join) = ContextOcean::spawn(ocean_cfg).unwrap();

        let backend = Arc::new(MockBackend::new(vec![
            // Classifier model response (heuristic returns Question at 0.70, model confirms)
            InferenceResponse {
                text: "question".into(),
                tokens_generated: 1,
                latency_ms: 80,
            },
            // REV.IKE cognition response
            InferenceResponse {
                text: "Photosynthesis is how plants convert light to energy.".into(),
                tokens_generated: 12,
                latency_ms: 280,
            },
        ]));

        let lake = Arc::new(MockLake);
        let injector = Arc::new(Injector::new(lake, 16));
        let (goose_tx, _goose_rx) = tokio::sync::mpsc::channel(8);

        let harness = MetaHarness::new(
            backend, injector, ocean, goose_tx, 16,
        );

        let mut sub = harness.subscribe();

        let result = harness.turn(
            "What is photosynthesis?".into(),
            "test-session".into(),
        ).await.unwrap();

        assert!(result.success);
        assert_eq!(result.route, crate::policy::Route::RevIke);
        assert!(result.response_text.contains("Photosynthesis"));

        // Should have received UI updates
        let mut phases = vec![];
        while let Ok(u) = sub.try_recv() {
            phases.push(u.phase);
        }
        assert!(phases.contains(&TurnPhase::Complete));

        // Give the deposit loop time to process
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        let stats = harness.budget_snapshot();
        assert!(stats.session_tokens_used > 0);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn planning_escalates_to_fable() {
        let dir = tempfile::tempdir().unwrap();
        let ocean_cfg = lite_notebook::ocean::OceanConfig {
            base_path: dir.path().to_path_buf(),
            flush_channel_capacity: 8,
            broadcast_capacity: 16,
            max_commit_retries: 2,
        };
        let (ocean, _join) = ContextOcean::spawn(ocean_cfg).unwrap();

        // FABLE response (heuristic catches "Plan a" so no classifier model call needed)
        let backend = Arc::new(MockBackend::new(vec![
            InferenceResponse {
                text: "1. Step one\n2. Step two\n3. Step three".into(),
                tokens_generated: 20,
                latency_ms: 8000,
            },
        ]));

        let lake = Arc::new(MockLake);
        let injector = Arc::new(Injector::new(lake, 16));
        let (goose_tx, _goose_rx) = tokio::sync::mpsc::channel(8);

        let harness = MetaHarness::new(
            backend, injector, ocean, goose_tx, 16,
        );

        let result = harness.turn(
            "Plan a 3-day trip to Tokyo".into(),
            "test-planning".into(),
        ).await.unwrap();

        assert!(result.success);
        assert_eq!(result.route, crate::policy::Route::Fable);
        assert!(result.response_text.contains("Step one"));
    }
}
