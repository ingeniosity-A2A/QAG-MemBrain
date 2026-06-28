//! Artificial ACC — conflict monitoring + self-correction.
//!
//! White paper §2: "A framework-level module dedicated to conflict
//! monitoring and self-correction, ensuring that edge models can
//! detect and recover from drift without the redundancy of
//! cloud-scale parameters."
//!
//! Named after the anterior cingulate cortex (ACC) in the human brain,
//! which detects cognitive conflicts and triggers course corrections.

use std::sync::Arc;
use std::collections::HashMap;

use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use tracing::{info, warn};

/// A detected conflict between two cognitive outputs.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CognitiveConflict {
    pub id: String,
    pub receipt_id_a: String,
    pub receipt_id_b: String,
    pub conflict_type: ConflictType,
    pub severity: f32,
    pub detected_at_ns: i64,
    pub resolution: Option<ConflictResolution>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ConflictType {
    /// Two agents disagree on the route for the same intent
    RoutingDisagreement,
    /// Trust score dropped significantly between turns
    TrustDrift,
    /// Budget exceeded without completion
    BudgetOverrun,
    /// Thermal throttling interrupted a cognition
    ThermalInterruption,
    /// Same query produced different outputs on retry
    NonDeterministicOutput,
    /// Policy violation (e.g., Knox safety triggered)
    PolicyViolation,
}

impl ConflictType {
    pub fn as_str(self) -> &'static str {
        match self {
            ConflictType::RoutingDisagreement       => "routing_disagreement",
            ConflictType::TrustDrift                => "trust_drift",
            ConflictType::BudgetOverrun             => "budget_overrun",
            ConflictType::ThermalInterruption       => "thermal_interruption",
            ConflictType::NonDeterministicOutput    => "non_deterministic_output",
            ConflictType::PolicyViolation           => "policy_violation",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ConflictResolution {
    /// Resolved by preferring the higher-trust output
    PreferHigherTrust,
    /// Resolved by escalating to FABLE for re-evaluation
    EscalateToFable,
    /// Resolved by rolling back to the previous turn
    Rollback,
    /// Resolved by asking the user to clarify
    AskUser,
    /// Unresolved — needs manual intervention
    Unresolved,
}

/// The Artificial ACC — monitors for conflicts and triggers corrections.
pub struct ArtificialACC {
    /// Detected conflicts (receipt_id → conflicts)
    conflicts: Arc<RwLock<Vec<CognitiveConflict>>>,
    /// Trust score history per session (for drift detection)
    trust_history: Arc<RwLock<HashMap<String, Vec<f32>>>>,
    /// Drift threshold — if trust drops by this much between turns, flag it
    drift_threshold: f32,
}

impl ArtificialACC {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            conflicts: Arc::new(RwLock::new(Vec::new())),
            trust_history: Arc::new(RwLock::new(HashMap::new())),
            drift_threshold: 0.2,
        })
    }

    /// Record a trust score for a session. Returns a drift conflict if detected.
    pub fn record_trust(&self, session_id: &str, trust: f32) -> Option<CognitiveConflict> {
        let mut history = self.trust_history.write();
        let entries = history.entry(session_id.into()).or_default();

        if let Some(&prev) = entries.last() {
            let drift = prev - trust;
            if drift > self.drift_threshold {
                warn!(
                    "Trust drift detected in session {}: {:.2} → {:.2} (Δ={:.2})",
                    session_id, prev, trust, drift
                );
                let conflict = CognitiveConflict {
                    id: format!("conflict_{}", chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0)),
                    receipt_id_a: format!("{}_prev", session_id),
                    receipt_id_b: format!("{}_curr", session_id),
                    conflict_type: ConflictType::TrustDrift,
                    severity: drift,
                    detected_at_ns: chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0),
                    resolution: Some(ConflictResolution::EscalateToFable),
                };
                self.conflicts.write().push(conflict.clone());
                entries.push(trust);
                return Some(conflict);
            }
        }

        entries.push(trust);
        None
    }

    /// Check for routing disagreements between agents.
    pub fn check_routing_conflict(
        &self,
        receipt_id: &str,
        route_a: &str,
        route_b: &str,
    ) -> Option<CognitiveConflict> {
        if route_a != route_b {
            let conflict = CognitiveConflict {
                id: format!("conflict_route_{}", receipt_id),
                receipt_id_a: receipt_id.into(),
                receipt_id_b: receipt_id.into(),
                conflict_type: ConflictType::RoutingDisagreement,
                severity: 0.5,
                detected_at_ns: chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0),
                resolution: Some(ConflictResolution::PreferHigherTrust),
            };
            self.conflicts.write().push(conflict.clone());
            Some(conflict)
        } else {
            None
        }
    }

    /// Get all unresolved conflicts.
    pub fn unresolved_conflicts(&self) -> Vec<CognitiveConflict> {
        self.conflicts.read().iter()
            .filter(|c| c.resolution == Some(ConflictResolution::Unresolved) || c.resolution.is_none())
            .cloned()
            .collect()
    }

    /// Get all conflicts (resolved + unresolved).
    pub fn all_conflicts(&self) -> Vec<CognitiveConflict> {
        self.conflicts.read().clone()
    }

    /// Resolve a conflict.
    pub fn resolve(&self, conflict_id: &str, resolution: ConflictResolution) {
        let mut conflicts = self.conflicts.write();
        for c in conflicts.iter_mut() {
            if c.id == conflict_id {
                c.resolution = Some(resolution.clone());
                info!("Resolved conflict {} with {:?}", conflict_id, resolution);
                break;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_trust_drift() {
        let acc = ArtificialACC::new();
        acc.record_trust("s1", 0.9);
        let conflict = acc.record_trust("s1", 0.5); // 0.4 drop > 0.2 threshold
        assert!(conflict.is_some());
        let c = conflict.unwrap();
        assert_eq!(c.conflict_type, ConflictType::TrustDrift);
        assert!(c.severity > 0.2);
    }

    #[test]
    fn no_drift_within_threshold() {
        let acc = ArtificialACC::new();
        acc.record_trust("s1", 0.8);
        let conflict = acc.record_trust("s1", 0.75); // 0.05 drop < 0.2 threshold
        assert!(conflict.is_none());
    }

    #[test]
    fn detects_routing_disagreement() {
        let acc = ArtificialACC::new();
        let conflict = acc.check_routing_conflict("r1", "RevIke", "Fable");
        assert!(conflict.is_some());
        assert_eq!(conflict.unwrap().conflict_type, ConflictType::RoutingDisagreement);
    }

    #[test]
    fn no_conflict_when_routes_agree() {
        let acc = ArtificialACC::new();
        let conflict = acc.check_routing_conflict("r1", "RevIke", "RevIke");
        assert!(conflict.is_none());
    }
}
