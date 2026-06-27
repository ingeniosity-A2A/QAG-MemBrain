//! AVA007 — Meta Harness
//!
//! The orchestration layer that sits between user input and the
//! Constellation agents. Fixes the inference quality problem by routing
//! every request through REV.IKE / FABLE / GOOSE / TASHI / EPOCH
//! instead of direct fetch to Gemma 2B.
//!
//! # Architecture
//!
//! ```text
//!   User Input
//!       │
//!       ▼
//!   ┌──────────────────────────────────────────────────────────┐
//!   │                  Meta Harness                            │
//!   │                                                          │
//!   │   ┌────────────┐  ┌──────────┐  ┌───────────────────┐    │
//!   │   │ Classifier │─▶│ Policy   │─▶│ Budget Tracker    │    │
//!   │   │ (REV.IKE)  │  │ (decide) │  │ (reserve/release) │    │
//!   │   └────────────┘  └──────────┘  └─────────┬─────────┘    │
//!   │                                            │              │
//!   │                              ┌─────────────▼──────────┐  │
//!   │                              │  Injector              │  │
//!   │                              │  (Context Lake recall) │  │
//!   │                              └─────────────┬──────────┘  │
//!   │                                            │              │
//!   │                              ┌─────────────▼──────────┐  │
//!   │                              │  Router                │  │
//!   │                              │  (REV.IKE/FABLE/GOOSE/ │  │
//!   │                              │   TASHI/EPOCH/USER)    │  │
//!   │                              └─────────────┬──────────┘  │
//!   │                                            │              │
//!   │                              ┌─────────────▼──────────┐  │
//!   │                              │  Inference Backend     │  │
//!   │                              │  (Gemma 2B / FABLE 12B)│  │
//!   │                              │  NO DIRECT FETCH       │  │
//!   │                              └─────────────┬──────────┘  │
//!   │                                            │              │
//!   │                              ┌─────────────▼──────────┐  │
//!   │                              │  Deposit → Ocean       │  │
//!   │                              │  + UI Broadcast        │  │
//!   │                              └────────────────────────┘  │
//!   └──────────────────────────────────────────────────────────┘
//! ```
//!
//! # Critical Invariants
//!
//! 1. **No direct fetch** — AVA007 NEVER calls llama-server directly.
//!    All inference goes through `InferenceBackend` trait.
//!
//! 2. **REV.IKE is read-only** — the Classifier marks all outputs with
//!    `Origin::RevIke` and the policy structurally forbids REV.IKE from
//!    producing Action receipts.
//!
//! 3. **Knox safety** — queries mentioning IMEI/SIM/root/modem are
//!    force-routed to REV.IKE (read-only). Expansion is refused.
//!
//! 4. **Injection before expansion** — every Decision first tries to
//!    inject Context Ocean context. Expansion (GOOSE) only happens for
//!    BrowserAction / CodeExecution intents.
//!
//! 5. **Budget enforcement** — every inference call goes through
//!    `BudgetTracker::reserve()` first. Thermal, token, and rate
//!    limits are atomic and non-bypassable.
//!
//! 6. **Audit trail** — every step emits a Receipt. The user can trace
//!    the full lineage of any AVA007 response via the parent_receipt DAG.

pub mod policy;
pub mod classifier;
pub mod budget;
pub mod injector;
pub mod inference;
pub mod router;
pub mod orchestrator;

pub use policy::{
    ActionMode, Decision, Intent, IntentBucket, ModelChoice, Route, decide,
};
pub use classifier::Classifier;
pub use budget::{
    BudgetDenialReason, BudgetLimits, BudgetReservation, BudgetSnapshot, BudgetTracker,
    ThermalState,
    SESSION_TOKEN_BUDGET, SESSION_DURATION_LIMIT,
    FABLE_MAX_CONCURRENT, FABLE_RATE_PER_MIN, GEMMA_MAX_TOK_PER_SEC,
    THERMAL_THROTTLE_TEMP_C, THERMAL_BACKOFF_TEMP_C,
};
pub use injector::{
    ContextLake, InjectedContext, Injector, RetrievalStrategy,
};
pub use inference::{
    InferenceBackend, InferenceRequest, InferenceResponse,
    LlamaServerBackend, FableBackend, RoutedBackend, MockBackend,
};
pub use router::{
    EpochCommand, GooseRequest, GooseService, Router, RouterResult, UiTarget,
};
pub use orchestrator::{
    MetaHarness, TurnPhase, TurnResult, TurnUpdate,
};
