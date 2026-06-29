//! FAPO — Fractional Pareto-Optimality Selection
//!
//! White paper §5: "Fractional Pareto-Optimality provides the mathematical
//! rigor for the Arena mechanism, filtering for the highest-fitness
//! capabilities and revelations while balancing accuracy against token costs."
//!
//! # Algorithm
//!
//!   1. Collect candidate capabilities (each has multiple objectives:
//!      accuracy, latency, token_cost, etc.)
//!   2. Compute the Pareto frontier — candidates not dominated by any other
//!   3. Apply fractional scoring — weight objectives by user priorities
//!   4. Select the top-k from the frontier
//!
//! # Use in AVA007
//!
//! When multiple capabilities (processors, models, expansion services)
//! can serve a request, FAPO selects the Pareto-optimal one based on:
//!   - Accuracy (success rate)
//!   - Latency (avg response time)
//!   - Token cost (tokens consumed)
//!   - Thermal impact (does it throttle the device?)

use std::cmp::Ordering;

use serde::{Deserialize, Serialize};

/// A candidate in the FAPO Arena — has multiple objectives to optimize.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Candidate {
    pub id: String,
    pub accuracy: f64,       // [0, 1] — higher is better
    pub latency_ms: f64,     // lower is better
    pub token_cost: f64,     // lower is better
    pub thermal_impact: f64, // [0, 1] — lower is better
    pub metadata: serde_json::Value,
}

/// Weights for each objective (user-defined priorities).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ObjectiveWeights {
    pub accuracy: f64,
    pub latency: f64,
    pub token_cost: f64,
    pub thermal_impact: f64,
}

impl Default for ObjectiveWeights {
    fn default() -> Self {
        Self {
            accuracy: 0.4,
            latency: 0.25,
            token_cost: 0.2,
            thermal_impact: 0.15,
        }
    }
}

/// A candidate on the Pareto frontier.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParetoCandidate {
    pub candidate: Candidate,
    pub fractional_score: f64,
    pub rank: usize,
}

/// Run FAPO selection on a set of candidates.
///
/// Returns the Pareto frontier sorted by fractional score (best first).
pub fn select(candidates: Vec<Candidate>, weights: &ObjectiveWeights) -> Vec<ParetoCandidate> {
    let frontier = pareto_frontier(&candidates);

    let mut scored: Vec<ParetoCandidate> = frontier.into_iter()
        .map(|c| {
            let score = fractional_score(&c, weights);
            ParetoCandidate {
                candidate: c,
                fractional_score: score,
                rank: 0,
            }
        })
        .collect();

    // Sort by fractional score descending
    scored.sort_by(|a, b| b.fractional_score.partial_cmp(&a.fractional_score)
        .unwrap_or(Ordering::Equal));

    // Assign ranks
    for (i, p) in scored.iter_mut().enumerate() {
        p.rank = i + 1;
    }

    scored
}

/// Compute the Pareto frontier — candidates not dominated by any other.
fn pareto_frontier(candidates: &[Candidate]) -> Vec<Candidate> {
    candidates.iter()
        .filter(|c| !is_dominated(c, candidates))
        .cloned()
        .collect()
}

/// Check if candidate `a` is dominated by any other candidate.
/// A is dominated if there exists B where B is at least as good in all
/// objectives AND strictly better in at least one.
fn is_dominated(a: &Candidate, all: &[Candidate]) -> bool {
    all.iter().any(|b| {
        b.accuracy >= a.accuracy
            && b.latency_ms <= a.latency_ms
            && b.token_cost <= a.token_cost
            && b.thermal_impact <= a.thermal_impact
            && (b.accuracy > a.accuracy
                || b.latency_ms < a.latency_ms
                || b.token_cost < a.token_cost
                || b.thermal_impact < a.thermal_impact)
    })
}

/// Compute the fractional score — weighted sum of normalized objectives.
fn fractional_score(c: &Candidate, w: &ObjectiveWeights) -> f64 {
    // All objectives normalized to [0, 1] where higher = better
    let accuracy_norm = c.accuracy;
    let latency_norm = 1.0 / (1.0 + c.latency_ms / 1000.0); // inverse of latency
    let cost_norm = 1.0 / (1.0 + c.token_cost / 1000.0); // inverse of cost
    let thermal_norm = 1.0 - c.thermal_impact;

    w.accuracy * accuracy_norm
        + w.latency * latency_norm
        + w.token_cost * cost_norm
        + w.thermal_impact * thermal_norm
}

/// Select the top-k candidates from the Pareto frontier.
pub fn select_top_k(
    candidates: Vec<Candidate>,
    weights: &ObjectiveWeights,
    k: usize,
) -> Vec<ParetoCandidate> {
    let mut scored = select(candidates, weights);
    scored.truncate(k);
    scored
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_candidate(id: &str, acc: f64, lat: f64, cost: f64, therm: f64) -> Candidate {
        Candidate {
            id: id.into(),
            accuracy: acc,
            latency_ms: lat,
            token_cost: cost,
            thermal_impact: therm,
            metadata: serde_json::json!({}),
        }
    }

    #[test]
    fn dominated_candidate_excluded_from_frontier() {
        let candidates = vec![
            make_candidate("good", 0.9, 100.0, 50.0, 0.1),
            make_candidate("bad", 0.5, 200.0, 100.0, 0.5), // dominated by "good"
        ];
        let frontier = select(candidates, &ObjectiveWeights::default());
        assert_eq!(frontier.len(), 1);
        assert_eq!(frontier[0].candidate.id, "good");
    }

    #[test]
    fn non_dominated_candidates_both_on_frontier() {
        let candidates = vec![
            make_candidate("fast", 0.7, 50.0, 100.0, 0.2),
            make_candidate("accurate", 0.95, 500.0, 200.0, 0.3),
        ];
        let frontier = select(candidates, &ObjectiveWeights::default());
        assert_eq!(frontier.len(), 2); // Neither dominates the other
    }

    #[test]
    fn top_k_returns_best_n() {
        // Use non-dominated candidates so all are on the frontier
        let candidates = vec![
            make_candidate("fast", 0.7, 50.0, 100.0, 0.2),
            make_candidate("accurate", 0.95, 500.0, 200.0, 0.3),
            make_candidate("cheap", 0.6, 300.0, 10.0, 0.1),
        ];
        let top2 = select_top_k(candidates, &ObjectiveWeights::default(), 2);
        assert_eq!(top2.len(), 2);
        assert!(top2[0].fractional_score >= top2[1].fractional_score);
    }

    #[test]
    fn weights_affect_ranking() {
        let candidates = vec![
            make_candidate("cheap", 0.5, 200.0, 10.0, 0.1),
            make_candidate("accurate", 0.95, 200.0, 500.0, 0.1),
        ];

        // Weight accuracy heavily → "accurate" wins
        let acc_weights = ObjectiveWeights { accuracy: 0.9, latency: 0.03, token_cost: 0.03, thermal_impact: 0.04 };
        let result = select(candidates.clone(), &acc_weights);
        assert_eq!(result[0].candidate.id, "accurate");

        // Weight token_cost heavily → "cheap" wins
        let cost_weights = ObjectiveWeights { accuracy: 0.03, latency: 0.03, token_cost: 0.9, thermal_impact: 0.04 };
        let result = select(candidates, &cost_weights);
        assert_eq!(result[0].candidate.id, "cheap");
    }
}
