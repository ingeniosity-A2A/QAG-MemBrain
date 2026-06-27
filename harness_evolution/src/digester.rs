//! Digester — transforms execution traces (Receipts) into DayDigests.
//!
//! Runs nightly. Pulls the last 24h of Receipts from the Context Lake,
//! groups them by session, identifies failures and patterns, and emits
//! a structured `DayDigest` that the Planner consumes.
//!
//! # What gets digested
//!
//! For each session:
//!   - Total receipts, total tokens, total latency
//!   - Outcome (Success / PartialSuccess / Failure / Abandoned)
//!   - Failure points (which processor produced a low-confidence output)
//!   - Trust score trajectory (did trust rise, fall, or stay flat?)
//!   - Route distribution (which agents handled how many turns?)
//!
//! For the day overall:
//!   - Session count, total turns
//!   - Per-slot failure rates
//!   - Per-route latency percentiles
//!   - Top failure patterns (clustered by FailureType)

use std::collections::HashMap;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tracing::info;

use lite_notebook::receipt::{Origin, Receipt, ReceiptKind};
use meta_harness::injector::ContextLake;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DayDigest {
    /// Date covered (UTC, YYYY-MM-DD)
    pub date: String,
    /// Total receipts in the day
    pub total_receipts: u64,
    /// Total sessions
    pub total_sessions: u64,
    /// Per-slot failure rates (slot → (failures, total))
    pub slot_stats: HashMap<String, SlotStats>,
    /// Per-route (Constellation agent) stats
    pub route_stats: HashMap<String, RouteStats>,
    /// Top failure patterns
    pub failure_patterns: Vec<FailurePattern>,
    /// Per-session digests
    pub sessions: Vec<SessionDigest>,
    /// Aggregate trust score (avg across all cognition receipts)
    pub avg_trust_score: f32,
    /// Total tokens consumed
    pub total_tokens: u64,
    /// Total latency in ms (sum of all processor latencies)
    pub total_latency_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SlotStats {
    pub total_invocations: u64,
    pub successes: u64,
    pub failures: u64,
    pub avg_confidence: f32,
    pub avg_latency_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RouteStats {
    pub total_turns: u64,
    pub avg_latency_ms: u64,
    pub avg_trust_score: f32,
    pub failure_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FailurePattern {
    pub failure_type: FailureType,
    pub slot: String,
    pub occurrence_count: u64,
    pub example_session_ids: Vec<String>,
    pub suggested_investigation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionDigest {
    pub session_id: String,
    pub receipt_count: u64,
    pub outcome: Outcome,
    pub failure_points: Vec<FailurePoint>,
    pub route_distribution: HashMap<String, u64>,
    pub trust_trajectory: TrustTrajectory,
    pub total_tokens: u64,
    pub total_latency_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FailurePoint {
    pub receipt_id: String,
    pub slot: String,
    pub failure_type: FailureType,
    pub confidence: f32,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TraceDigest {
    /// A single trace = one turn (perception → cognition → action)
    pub session_id: String,
    pub turn_id: String,
    pub perception_receipt_id: String,
    pub cognition_receipt_ids: Vec<String>,
    pub action_receipt_ids: Vec<String>,
    pub outcome: Outcome,
    pub total_latency_ms: u64,
    pub total_tokens: u64,
    pub route: String,
    pub confidence: f32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Outcome {
    Success,
    PartialSuccess,
    Failure,
    Abandoned,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FailureType {
    /// Processor returned low confidence (< 0.4)
    LowConfidence,
    /// Processor returned a failure output
    ProcessorFailure,
    /// Budget exhausted before completion
    BudgetExhausted,
    /// Thermal throttling kicked in
    ThermalThrottled,
    /// Latency exceeded budget
    LatencyBudgetExceeded,
    /// User explicitly cancelled
    UserCancelled,
    /// No cognition produced (routing loop)
    NoCognition,
    /// Knox safety blocked the action
    KnoxBlocked,
    /// Unknown failure
    Unknown,
}

impl FailureType {
    pub fn as_str(self) -> &'static str {
        match self {
            FailureType::LowConfidence        => "low_confidence",
            FailureType::ProcessorFailure     => "processor_failure",
            FailureType::BudgetExhausted      => "budget_exhausted",
            FailureType::ThermalThrottled     => "thermal_throttled",
            FailureType::LatencyBudgetExceeded=> "latency_budget_exceeded",
            FailureType::UserCancelled        => "user_cancelled",
            FailureType::NoCognition          => "no_cognition",
            FailureType::KnoxBlocked           => "knox_blocked",
            FailureType::Unknown              => "unknown",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrustTrajectory {
    pub start_trust: f32,
    pub end_trust: f32,
    pub min_trust: f32,
    pub max_trust: f32,
    /// "rising" | "falling" | "flat"
    pub trend: String,
}

pub struct Digester {
    lake: Arc<dyn ContextLake>,
}

impl Digester {
    pub fn new(lake: Arc<dyn ContextLake>) -> Self {
        Self { lake }
    }

    /// Digest the last 24 hours of activity into a DayDigest.
    pub async fn digest_day(&self, date: chrono::NaiveDate) -> anyhow::Result<DayDigest> {
        let start_ns = date.and_hms_opt(0, 0, 0).unwrap().and_utc().timestamp_nanos_opt().unwrap_or(0);
        let end_ns = start_ns + 86_400_000_000_000; // +24h in nanos

        info!("Digesting receipts from {} to {}", date, date.succ_opt().unwrap());

        // Pull all sessions — in production this queries the Context Lake
        // by timestamp range. Here we approximate by getting recent receipts.
        let recent = self.lake.session_recent("", 10000).await
            .unwrap_or_default();

        let filtered: Vec<&Receipt> = recent.iter()
            .filter(|r| r.timestamp_ns >= start_ns && r.timestamp_ns < end_ns)
            .collect();

        info!("Found {} receipts for {}", filtered.len(), date);

        // Group by session_id
        let mut sessions: HashMap<String, Vec<&Receipt>> = HashMap::new();
        for r in &filtered {
            sessions.entry(r.session_id.to_string())
                .or_insert_with(Vec::new)
                .push(*r);
        }

        // Digest each session
        let mut session_digests = Vec::new();
        let mut slot_stats: HashMap<String, SlotStats> = HashMap::new();
        let mut route_stats: HashMap<String, RouteStats> = HashMap::new();
        let mut all_failures: Vec<FailurePoint> = Vec::new();
        let mut total_trust = 0.0f32;
        let mut trust_count = 0u64;
        let mut total_tokens = 0u64;
        let mut total_latency = 0u64;

        for (sid, receipts) in &sessions {
            let digest = self.digest_session(sid, receipts);

            // Aggregate stats
            for (route, count) in &digest.route_distribution {
                let rs = route_stats.entry(route.clone()).or_default();
                rs.total_turns += count;
            }
            for fp in &digest.failure_points {
                all_failures.push(fp.clone());
                let ss = slot_stats.entry(fp.slot.clone()).or_default();
                ss.failures += 1;
                ss.total_invocations += 1;
            }
            for r in receipts {
                if r.kind == ReceiptKind::Cognition {
                    total_trust += r.trust_score;
                    trust_count += 1;
                    if let Some(toks) = r.metadata.get("tokens_generated") {
                        if let Ok(n) = toks.parse::<u64>() {
                            total_tokens += n;
                        }
                    }
                    if let Some(lat) = r.metadata.get("latency_ms") {
                        if let Ok(n) = lat.parse::<u64>() {
                            total_latency += n;
                        }
                    }
                }
            }

            session_digests.push(digest);
        }

        // Compute success counts per slot (rough heuristic: a slot that
        // produced a cognition receipt without a failure point is a success)
        for r in &filtered {
            if let Some(slot) = self.slot_for_receipt(r) {
                let ss = slot_stats.entry(slot).or_default();
                ss.total_invocations += 1;
                // Heuristic: cognition receipts with trust >= 0.5 are successes
                if r.kind == ReceiptKind::Cognition && r.trust_score >= 0.5 {
                    ss.successes += 1;
                }
            }
        }

        // Identify top failure patterns
        let failure_patterns = self.cluster_failures(&all_failures);

        let avg_trust = if trust_count > 0 {
            total_trust / trust_count as f32
        } else {
            0.0
        };

        Ok(DayDigest {
            date: date.format("%Y-%m-%d").to_string(),
            total_receipts: filtered.len() as u64,
            total_sessions: sessions.len() as u64,
            slot_stats,
            route_stats,
            failure_patterns,
            sessions: session_digests,
            avg_trust_score: avg_trust,
            total_tokens,
            total_latency_ms: total_latency,
        })
    }

    fn digest_session(&self, session_id: &str, receipts: &[&Receipt]) -> SessionDigest {
        // Sort by timestamp
        let mut sorted: Vec<&&Receipt> = receipts.iter().collect();
        sorted.sort_by_key(|r| r.timestamp_ns);

        let receipt_count = sorted.len() as u64;

        // Identify failure points (low trust or control receipts with errors)
        let mut failure_points = Vec::new();
        let mut trust_scores: Vec<f32> = Vec::new();

        for r in &sorted {
            if r.kind == ReceiptKind::Cognition {
                trust_scores.push(r.trust_score);
                if r.trust_score < 0.4 {
                    failure_points.push(FailurePoint {
                        receipt_id: r.id.to_string(),
                        slot: self.slot_for_receipt(r).unwrap_or_else(|| "unknown".into()),
                        failure_type: FailureType::LowConfidence,
                        confidence: r.trust_score,
                        reason: r.content.to_string(),
                    });
                }
            }
            if r.kind == ReceiptKind::Control && r.content.contains("error") {
                failure_points.push(FailurePoint {
                    receipt_id: r.id.to_string(),
                    slot: "system".into(),
                    failure_type: FailureType::ProcessorFailure,
                    confidence: 0.0,
                    reason: r.content.to_string(),
                });
            }
        }

        // Route distribution
        let mut route_distribution: HashMap<String, u64> = HashMap::new();
        for r in &sorted {
            if r.kind == ReceiptKind::Cognition {
                *route_distribution.entry(r.origin.as_str().to_string()).or_insert(0) += 1;
            }
        }

        // Trust trajectory
        let trust_trajectory = if trust_scores.is_empty() {
            TrustTrajectory {
                start_trust: 0.0,
                end_trust: 0.0,
                min_trust: 0.0,
                max_trust: 0.0,
                trend: "flat".into(),
            }
        } else {
            let start = *trust_scores.first().unwrap();
            let end = *trust_scores.last().unwrap();
            let min = trust_scores.iter().cloned().fold(f32::INFINITY, f32::min);
            let max = trust_scores.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
            let trend = if end > start + 0.1 { "rising" }
                        else if end < start - 0.1 { "falling" }
                        else { "flat" };
            TrustTrajectory {
                start_trust: start,
                end_trust: end,
                min_trust: min,
                max_trust: max,
                trend: trend.into(),
            }
        };

        // Outcome determination
        let outcome = if failure_points.is_empty() {
            Outcome::Success
        } else if failure_points.len() as f32 / receipt_count as f32 > 0.5 {
            Outcome::Failure
        } else if trust_trajectory.end_trust < 0.3 {
            Outcome::Abandoned
        } else {
            Outcome::PartialSuccess
        };

        // Total tokens + latency
        let total_tokens: u64 = sorted.iter()
            .filter_map(|r| r.metadata.get("tokens_generated"))
            .filter_map(|s| s.parse::<u64>().ok())
            .sum();
        let total_latency: u64 = sorted.iter()
            .filter_map(|r| r.metadata.get("latency_ms"))
            .filter_map(|s| s.parse::<u64>().ok())
            .sum();

        SessionDigest {
            session_id: session_id.to_string(),
            receipt_count,
            outcome,
            failure_points,
            route_distribution,
            trust_trajectory,
            total_tokens,
            total_latency_ms: total_latency,
        }
    }

    fn slot_for_receipt(&self, r: &Receipt) -> Option<String> {
        match r.origin {
            Origin::RevIke => Some("classifier".into()),
            Origin::Fable  => Some("planner".into()),
            Origin::Goose  => Some("router".into()),
            Origin::Tashi  => Some("memory".into()),
            Origin::Epoch  => Some("renderer".into()),
            Origin::User   => None,
        }
    }

    fn cluster_failures(&self, failures: &[FailurePoint]) -> Vec<FailurePattern> {
        let mut by_type: HashMap<(String, FailureType), Vec<&FailurePoint>> = HashMap::new();
        for f in failures {
            let key = (f.slot.clone(), f.failure_type);
            by_type.entry(key).or_default().push(f);
        }

        let mut patterns: Vec<FailurePattern> = by_type.into_iter()
            .map(|((slot, ftype), examples)| {
                let example_sids: Vec<String> = examples.iter()
                    .take(3)
                    .map(|e| e.receipt_id.clone())
                    .collect();
                let suggestion = match ftype {
                    FailureType::LowConfidence =>
                        format!("Tune the {} prompt or add few-shot examples to lift confidence", slot),
                    FailureType::ProcessorFailure =>
                        format!("Inspect {} error logs; check for model failures or timeouts", slot),
                    FailureType::BudgetExhausted =>
                        format!("{} is consuming too many tokens; reduce context_budget or switch model", slot),
                    FailureType::ThermalThrottled =>
                        format!("{} invoked during thermal event; consider lighter model or scheduling", slot),
                    FailureType::LatencyBudgetExceeded =>
                        format!("{} is too slow; reduce context window or escalate to faster model", slot),
                    _ => format!("Investigate {} failures", slot),
                };
                FailurePattern {
                    failure_type: ftype,
                    slot,
                    occurrence_count: examples.len() as u64,
                    example_session_ids: example_sids,
                    suggested_investigation: suggestion,
                }
            })
            .collect();

        // Sort by occurrence count descending
        patterns.sort_by(|a, b| b.occurrence_count.cmp(&a.occurrence_count));
        patterns
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use lite_notebook::receipt::{Origin, Receipt, ReceiptKind};
    use meta_harness::injector::ContextLake;
    use uuid::Uuid;

    struct MockLake { receipts: Vec<Receipt> }
    #[async_trait::async_trait]
    impl ContextLake for MockLake {
        async fn recall_similar(&self, _e: &[f32], _k: usize) -> anyhow::Result<Vec<Receipt>> { Ok(self.receipts.clone()) }
        async fn session_recent(&self, _s: &str, _n: usize) -> anyhow::Result<Vec<Receipt>> { Ok(self.receipts.clone()) }
        async fn lineage_chain(&self, _id: Uuid) -> anyhow::Result<Vec<Receipt>> { Ok(vec![]) }
        async fn user_memories(&self, _l: usize) -> anyhow::Result<Vec<Receipt>> { Ok(vec![]) }
    }

    #[tokio::test]
    async fn digest_empty_day() {
        let lake = Arc::new(MockLake { receipts: vec![] });
        let digester = Digester::new(lake);
        let digest = digester.digest_day(chrono::Utc::now().date_naive()).await.unwrap();
        assert_eq!(digest.total_receipts, 0);
        assert_eq!(digest.total_sessions, 0);
    }

    #[tokio::test]
    async fn digest_session_with_low_confidence() {
        let mut receipts = Vec::new();
        for i in 0..5 {
            let trust = if i == 2 { 0.2 } else { 0.8 }; // one low-confidence receipt
            let r = Receipt::new("sess-1".into(), Origin::RevIke, ReceiptKind::Cognition,
                format!("cog-{i}").into(), None)
                .with_trust(trust)
                .with_metadata("latency_ms", "100")
                .with_metadata("tokens_generated", "20");
            receipts.push(r);
        }
        let lake = Arc::new(MockLake { receipts });
        let digester = Digester::new(lake);
        let digest = digester.digest_day(chrono::Utc::now().date_naive()).await.unwrap();

        assert_eq!(digest.total_sessions, 1);
        assert!(!digest.sessions.is_empty());
        assert!(!digest.sessions[0].failure_points.is_empty());
        assert_eq!(digest.sessions[0].failure_points[0].failure_type, FailureType::LowConfidence);
    }
}
