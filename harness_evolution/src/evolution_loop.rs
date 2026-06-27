//! Evolution Loop — the overnight orchestration.
//!
//! Runs on a schedule (default: 3am daily). Executes the full pipeline:
//!
//!   1. Digest yesterday's receipts → DayDigest
//!   2. Plan evolution proposals → Vec<EvolutionProposal>
//!   3. Evolve each proposal → register candidates
//!   4. Evaluate existing candidates → CriticDecision[] (promote/reject/extend)
//!   5. Persist report to Context Ocean
//!
//! In production, this is invoked by a cron job or systemd timer.
//! In tests, it can be invoked manually.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tracing::{error, info, warn};

use context_lake::ContextLake as _;
use lite_notebook::ocean::ContextOcean;
use lite_notebook::receipt::{Origin, Receipt, ReceiptKind};

use crate::critic::{Critic, CriticAction, CriticDecision};
use crate::digester::{Digester, DayDigest};
use crate::evolver::{Evolver, EvolutionResult};
use crate::metrics::MetricsStore;
use crate::planner::{EvolutionPlanner, EvolutionProposal};
use crate::registry::ProcessorRegistry;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvolutionReport {
    pub started_at: i64,
    pub finished_at: i64,
    pub duration_ms: u64,
    pub date_digested: String,
    pub receipts_digested: u64,
    pub sessions_digested: u64,
    pub proposals_generated: usize,
    pub proposals_evolved: usize,
    pub proposals_rejected_low_confidence: usize,
    pub critic_decisions: Vec<CriticDecision>,
    pub promotions: usize,
    pub rejections: usize,
    pub extensions: usize,
    pub rollbacks: usize,
    pub success: bool,
    pub error: Option<String>,
}

pub struct EvolutionLoop {
    digester: Arc<Digester>,
    planner: Arc<EvolutionPlanner>,
    evolver: Arc<Evolver>,
    critic: Arc<Critic>,
    registry: Arc<ProcessorRegistry>,
    metrics: Arc<MetricsStore>,
    ocean: ContextOcean,
}

impl EvolutionLoop {
    pub fn new(
        digester: Arc<Digester>,
        planner: Arc<EvolutionPlanner>,
        evolver: Arc<Evolver>,
        critic: Arc<Critic>,
        registry: Arc<ProcessorRegistry>,
        metrics: Arc<MetricsStore>,
        ocean: ContextOcean,
    ) -> Self {
        Self {
            digester, planner, evolver, critic,
            registry, metrics, ocean,
        }
    }

    /// Run one evolution cycle for the given date.
    pub async fn run_for_date(&self, date: chrono::NaiveDate) -> EvolutionReport {
        let started_at = chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0);
        info!("=== Evolution Loop started for {} ===", date);

        let mut report = EvolutionReport {
            started_at,
            finished_at: 0,
            duration_ms: 0,
            date_digested: date.format("%Y-%m-%d").to_string(),
            receipts_digested: 0,
            sessions_digested: 0,
            proposals_generated: 0,
            proposals_evolved: 0,
            proposals_rejected_low_confidence: 0,
            critic_decisions: vec![],
            promotions: 0,
            rejections: 0,
            extensions: 0,
            rollbacks: 0,
            success: true,
            error: None,
        };

        // ── Phase 1: Digest ─────────────────────────────────────────
        let digest: DayDigest = match self.digester.digest_day(date).await {
            Ok(d) => {
                info!("Digested {} receipts across {} sessions",
                    d.total_receipts, d.total_sessions);
                report.receipts_digested = d.total_receipts;
                report.sessions_digested = d.total_sessions;
                d
            }
            Err(e) => {
                error!("Digest failed: {e}");
                report.success = false;
                report.error = Some(format!("digest failed: {e}"));
                self.finalize_report(report, started_at).await;
                return report;
            }
        };

        // ── Phase 2: Plan ───────────────────────────────────────────
        let proposals: Vec<EvolutionProposal> = match self.planner.plan(&digest).await {
            p => p,
        };
        report.proposals_generated = proposals.len();
        info!("Planner generated {} proposals", proposals.len());

        // ── Phase 3: Evolve ─────────────────────────────────────────
        let mut evolution_results: Vec<EvolutionResult> = Vec::new();
        for proposal in &proposals {
            let result = self.evolver.evolve(proposal).await;
            if result.success {
                report.proposals_evolved += 1;
            } else {
                report.proposals_rejected_low_confidence += 1;
            }
            evolution_results.push(result);
        }

        // ── Phase 4: Critic ────────────────────────────────────────
        let decisions = self.critic.evaluate_all().await;
        for d in &decisions {
            match d.action {
                CriticAction::Promote => report.promotions += 1,
                CriticAction::Reject  => report.rejections += 1,
                CriticAction::Extend  => report.extensions += 1,
                CriticAction::Rollback=> report.rollbacks += 1,
                CriticAction::NoOp    => {}
            }
        }
        report.critic_decisions = decisions;

        // ── Phase 5: Persist report to Context Ocean ────────────────
        let report_receipt = Receipt::new(
            "evolution_loop".into(),
            Origin::Tashi,
            ReceiptKind::Memory,
            serde_json::to_string(&report).unwrap_or_default().into(),
            None,
        )
        .with_trust(0.95)
        .with_metadata("loop_date", report.date_digested.clone())
        .with_metadata("proposals", report.proposals_generated.to_string())
        .with_metadata("promotions", report.promotions.to_string());

        if let Err(e) = self.ocean.deposit(report_receipt).await {
            warn!("Failed to deposit evolution report: {e}");
        }

        self.finalize_report(report, started_at).await
    }

    /// Convenience: run for "yesterday" (the most common overnight invocation).
    pub async fn run_for_yesterday(&self) -> EvolutionReport {
        let yesterday = chrono::Utc::now().date_naive() - chrono::Duration::days(1);
        self.run_for_date(yesterday).await
    }

    async fn finalize_report(&self, mut report: EvolutionReport, started_at: i64) -> EvolutionReport {
        let finished_at = chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0);
        report.finished_at = finished_at;
        report.duration_ms = ((finished_at - started_at) / 1_000_000) as u64;

        info!("=== Evolution Loop finished in {}ms ===", report.duration_ms);
        info!("  Proposals generated: {}", report.proposals_generated);
        info!("  Proposals evolved:   {}", report.proposals_evolved);
        info!("  Promotions:           {}", report.promotions);
        info!("  Rejections:           {}", report.rejections);
        info!("  Extensions:           {}", report.extensions);
        info!("  Rollbacks:            {}", report.rollbacks);

        report
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::digester::Digester;
    use context_lake::{DuckDbContextLake, LakeConfig};
    use lite_notebook::ocean::OceanConfig;

    async fn make_test_loop(
        dir: &std::path::Path,
    ) -> (EvolutionLoop, Arc<ProcessorRegistry>) {
        // Context Ocean
        let ocean_cfg = OceanConfig {
            base_path: dir.to_path_buf(),
            flush_channel_capacity: 8,
            broadcast_capacity: 16,
            max_commit_retries: 2,
        };
        let (ocean, _) = ContextOcean::spawn(ocean_cfg).unwrap();

        // Context Lake (empty)
        let lake_cfg = LakeConfig {
            db_path: ":memory:".into(),
            iceberg_root: dir.join("iceberg").to_string_lossy().into(),
            default_recall_k: 8,
            embedding_dim: 384,
        };
        let lake = DuckDbContextLake::open(lake_cfg).unwrap();

        // Registry
        let registry = Arc::new(ProcessorRegistry::new());

        // Components
        let digester = Arc::new(Digester::new(lake.clone()));
        let planner = Arc::new(EvolutionPlanner::new(registry.clone()));
        let evolver = Arc::new(Evolver::new(registry.clone()));
        let critic = Arc::new(Critic::new(registry.clone()));
        let metrics = MetricsStore::new(dir.join("metrics.jsonl"), 1000);

        let loop_ = EvolutionLoop::new(
            digester, planner, evolver, critic,
            registry.clone(), metrics, ocean,
        );

        (loop_, registry)
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn evolution_loop_runs_on_empty_data() {
        let dir = tempfile::tempdir().unwrap();
        let (loop_, _registry) = make_test_loop(dir.path()).await;

        let report = loop_.run_for_yesterday().await;

        assert!(report.success);
        assert_eq!(report.receipts_digested, 0);
        assert_eq!(report.proposals_generated, 0);
        assert_eq!(report.proposals_evolved, 0);
        assert!(report.duration_ms < 5000);
    }
}
