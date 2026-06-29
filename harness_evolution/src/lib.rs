//! AVA007 — Harness Evolution
//!
//! Self-evolving harness inspired by HarnessX. Overnight, the system
//! digests execution traces, identifies weak processors, proposes
//! modifications, A/B tests them in shadow mode, and promotes winners.
//!
//! # Architecture
//!
//! ```text
//!   ┌──────────────────────────────────────────────────────────┐
//!   │                  Evolution Loop (nightly)                │
//!   │                                                          │
//!   │   1. Digester     — Context Lake → DayDigest             │
//!   │      ↓                                                   │
//!   │   2. Planner      — DayDigest → EvolutionProposal[]      │
//!   │      ↓                                                   │
//!   │   3. Evolver      — Proposal → Candidate processor       │
//!   │      ↓                                                   │
//!   │   4. (next day)   — shadow A/B test via Registry         │
//!   │      ↓                                                   │
//!   │   5. Critic       — metrics → Promote/Reject/Rollback    │
//!   │      ↓                                                   │
//!   │   6. Metrics      — persist outcomes, calibration        │
//!   └──────────────────────────────────────────────────────────┘
//! ```
//!
//! Every processor (classifier, injector, router, policy) implements
//! `HarnessProcessor`. Versions are tracked, hashes detect drift,
//! performance scores (EMA) drive promotion decisions.

pub mod processor;
pub mod registry;
pub mod digester;
pub mod planner;
pub mod evolver;
pub mod critic;
pub mod metrics;
pub mod evolution_loop;

pub use processor::{HarnessProcessor, ProcessorConfig, ProcessorInput, ProcessorOutput,
                    AccumulatedContext, ClassifiedIntent, InjectionDecision,
                    BudgetSnapshot, ThermalState, RoutingRule, ContextStrategy};
pub use registry::{ProcessorRegistry, DeploymentStrategy, CandidateProcessor, ProcessorRoute};
pub use digester::{Digester, TraceDigest, DayDigest, Outcome, FailureType, FailurePoint};
pub use planner::{EvolutionPlanner, EvolutionProposal, ChangeType, HarnessModification};
pub use evolver::{Evolver, EvolutionResult};
pub use critic::{Critic, CriticDecision, CriticAction};
pub use metrics::{MetricsStore, ProcessorMetrics, InvocationRecord};
pub use evolution_loop::{EvolutionLoop, EvolutionReport};
