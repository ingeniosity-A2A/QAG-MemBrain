//! Integration test: full AVA007 pipeline end-to-end.
//!
//! Verifies that the bootstrap wires together correctly and a single
//! user turn flows through classify → decide → inject → route → deposit.

use std::sync::Arc;

use mobile_runtime::{Ava007Runtime, RuntimeConfig};
use meta_harness::inference::{InferenceRequest, InferenceResponse, MockBackend};

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn full_pipeline_question_to_revike() {
    let dir = tempfile::tempdir().unwrap();
    let cfg = RuntimeConfig::for_test(dir.path().to_path_buf());

    let backend = Arc::new(MockBackend::new(vec![
        InferenceResponse {
            text: "The Eiffel Tower is in Paris.".into(),
            tokens_generated: 10,
            latency_ms: 250,
        },
    ]));

    let runtime = Ava007Runtime::bootstrap(cfg, backend).await.unwrap();
    let result = runtime.turn("Where is the Eiffel Tower?", "itest-1").await.unwrap();

    assert!(result.success);
    assert_eq!(result.route, meta_harness::Route::RevIke);
    assert!(result.response_text.contains("Eiffel Tower"));

    let snap = runtime.budget_snapshot();
    assert!(snap.session_tokens_used > 0);

    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn full_pipeline_planning_escalates_to_fable() {
    let dir = tempfile::tempdir().unwrap();
    let cfg = RuntimeConfig::for_test(dir.path().to_path_buf());

    let backend = Arc::new(MockBackend::new(vec![
        InferenceResponse {
            text: "planning".into(),
            tokens_generated: 1,
            latency_ms: 80,
        },
        InferenceResponse {
            text: "1. Research flights\n2. Book hotel\n3. Plan itinerary".into(),
            tokens_generated: 30,
            latency_ms: 9000,
        },
    ]));

    let runtime = Ava007Runtime::bootstrap(cfg, backend).await.unwrap();
    let result = runtime.turn("Plan a trip to Tokyo", "itest-2").await.unwrap();

    assert!(result.success);
    assert_eq!(result.route, meta_harness::Route::Fable);
    assert!(result.response_text.contains("Research flights"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn knox_sensitive_query_blocked_from_expansion() {
    let dir = tempfile::tempdir().unwrap();
    let cfg = RuntimeConfig::for_test(dir.path().to_path_buf());

    let backend = Arc::new(MockBackend::new(vec![
        InferenceResponse {
            text: "I can't help with SIM unlocking — Knox must stay intact.".into(),
            tokens_generated: 15,
            latency_ms: 200,
        },
    ]));

    let runtime = Ava007Runtime::bootstrap(cfg, backend).await.unwrap();
    let result = runtime.turn("How do I unlock the SIM carrier?", "itest-3").await.unwrap();

    assert_eq!(result.route, meta_harness::Route::RevIke);
    assert!(result.decision.rationale.contains("KNOX-SENSITIVE"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn ui_subscribers_receive_all_phases() {
    let dir = tempfile::tempdir().unwrap();
    let cfg = RuntimeConfig::for_test(dir.path().to_path_buf());

    let backend = Arc::new(MockBackend::new(vec![
        InferenceResponse {
            text: "42".into(),
            tokens_generated: 1,
            latency_ms: 100,
        },
    ]));

    let runtime = Ava007Runtime::bootstrap(cfg, backend).await.unwrap();
    let mut sub = runtime.subscribe();

    let _ = runtime.turn("What is 6*7?", "itest-4").await.unwrap();

    let mut phases = vec![];
    while let Ok(u) = sub.try_recv() {
        phases.push(u.phase);
    }

    use meta_harness::TurnPhase::*;
    assert!(phases.contains(&Classifying), "missing Classifying");
    assert!(phases.contains(&Deciding), "missing Deciding");
    assert!(phases.contains(&Routing), "missing Routing");
    assert!(phases.contains(&Complete), "missing Complete");
}
