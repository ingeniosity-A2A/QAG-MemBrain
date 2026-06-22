//! Meta Harness — AMOS v2.1 first-class runtime wrapper.
//!
//! Universal interceptor that wraps every subsystem call. Built as a
//! Rust crate so it can be exposed via NDK (Android) and WASM (browser).
//!
//! Architecture:
//!   USER -> AVA007 -> [META HARNESS] -> {REV.IKE, FABLE, GOOSE, TASHI, CONSTELLATION}
//!
//! All public types implement `serde::Serialize` so they can be
//! serialized to ArrowJS Sandbox payloads and/or TASHI audit events.

#![forbid(unsafe_code)]
#![deny(missing_debug_implementations)]

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Which AMOS pillar is being intercepted.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Pillar {
    Ava007,
    RevIke,
    Fable,
    Goose,
    Tashi,
    Constellation,
    Epoch,
    Temporal,
}

impl Pillar {
    pub fn as_str(&self) -> &'static str {
        match self {
            Pillar::Ava007 => "ava007",
            Pillar::RevIke => "rev_ike",
            Pillar::Fable => "fable",
            Pillar::Goose => "goose",
            Pillar::Tashi => "tashi",
            Pillar::Constellation => "constellation",
            Pillar::Epoch => "epoch",
            Pillar::Temporal => "temporal",
        }
    }
}

/// A single interception request. The caller provides the pillar, the
/// operation name, and a opaque payload (typically a JSON value).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Intercept {
    pub pillar: Pillar,
    pub operation: String,
    pub payload: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<InterceptMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InterceptMetadata {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trace_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deadline_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub require_local: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confidence_threshold: Option<f32>,
}

/// Result of an interception.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InterceptionResult {
    pub allowed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<InterceptionError>,
    pub policy_decision: PolicyDecision,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum InterceptionError {
    ValidationFailed { details: Vec<String> },
    PolicyViolation { policy: String, reason: String },
    ConfidenceTooLow { score: f32, threshold: f32 },
    ArbitrationFailed { conflicts: Vec<String> },
    ExecutionFailed { cause: String },
    DeadlineExceeded { deadline_ms: u64 },
}

/// A policy decision returned by the PolicyEngine.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyDecision {
    pub allow: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub policy: Option<String>,
    pub reason: String,
}

/// An audit event emitted by AuditLogger.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEvent {
    pub trace_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    pub pillar: String,
    pub operation: String,
    pub phase: AuditPhase,
    pub timestamp_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result_summary: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuditPhase {
    Pre,
    Post,
    ValidationFailed,
    PolicyViolation,
    ExecutionFailed,
    ArbitrationFailed,
}

/// Meta Harness top-level facade.
#[derive(Debug)]
pub struct MetaHarness {
    inner: Arc<Mutex<HarnessInner>>,
}

#[derive(Debug)]
struct HarnessInner {
    policies: Vec<Policy>,
    audit_log: Vec<AuditEvent>,
    rate_limit_state: HashMap<String, RateLimitState>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Policy {
    pub id: String,
    pub kind: PolicyKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pillar: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub operation: Option<String>,
    pub params: serde_json::Value,
    pub reason: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PolicyKind {
    RateLimit,
    Boundary,
    Redaction,
    RequireLocal,
    Budget,
}

#[derive(Debug, Clone)]
struct RateLimitState {
    count: u64,
    window_start: Instant,
}

impl Default for MetaHarness {
    fn default() -> Self {
        Self::new()
    }
}

impl MetaHarness {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(HarnessInner {
                policies: Vec::new(),
                audit_log: Vec::new(),
                rate_limit_state: HashMap::new(),
            })),
        }
    }

    /// Load policies from external source (e.g. DuckDB governance store).
    pub fn load_policies(&self, policies: Vec<Policy>) {
        let mut inner = self.inner.lock().expect("harness mutex poisoned");
        inner.policies = policies;
        inner.rate_limit_state.clear();
    }

    /// Synchronously intercept a request. The caller is responsible for
    /// actually executing the operation; this function only validates
    /// and audits.
    pub fn intercept(&self, intercept: &Intercept) -> InterceptionResult {
        let started = Instant::now();
        let trace_id = intercept
            .metadata
            .as_ref()
            .and_then(|m| m.trace_id.clone())
            .unwrap_or_else(generate_trace_id);

        // 1. Emit pre-event
        self.log_audit(AuditEvent {
            trace_id: trace_id.clone(),
            session_id: intercept.metadata.as_ref().and_then(|m| m.session_id.clone()),
            pillar: intercept.pillar.as_str().to_string(),
            operation: intercept.operation.clone(),
            phase: AuditPhase::Pre,
            timestamp_ms: now_ms(),
            error: None,
            result_summary: None,
        });

        // 2. Evaluate policies
        let policy_decision = self.evaluate_policies(intercept);
        if !policy_decision.allow {
            let err = InterceptionError::PolicyViolation {
                policy: policy_decision.policy.clone().unwrap_or_default(),
                reason: policy_decision.reason.clone(),
            };
            self.log_audit(AuditEvent {
                trace_id: trace_id.clone(),
                session_id: intercept.metadata.as_ref().and_then(|m| m.session_id.clone()),
                pillar: intercept.pillar.as_str().to_string(),
                operation: intercept.operation.clone(),
                phase: AuditPhase::PolicyViolation,
                timestamp_ms: now_ms(),
                error: Some(serde_json::to_value(&err).unwrap_or(serde_json::Value::Null)),
                result_summary: None,
            });
            return InterceptionResult {
                allowed: false,
                result: None,
                error: Some(err),
                policy_decision,
                duration_ms: started.elapsed().as_millis() as u64,
            };
        }

        // 3. (Execution is the caller's responsibility — call execute() after this.)

        // 4. Emit post-event
        self.log_audit(AuditEvent {
            trace_id: trace_id.clone(),
            session_id: intercept.metadata.as_ref().and_then(|m| m.session_id.clone()),
            pillar: intercept.pillar.as_str().to_string(),
            operation: intercept.operation.clone(),
            phase: AuditPhase::Post,
            timestamp_ms: now_ms(),
            error: None,
            result_summary: Some("intercept allowed".to_string()),
        });

        InterceptionResult {
            allowed: true,
            result: None,
            error: None,
            policy_decision,
            duration_ms: started.elapsed().as_millis() as u64,
        }
    }

    /// Drain the audit log (called by TASHI L1 writer on flush interval).
    pub fn drain_audit_log(&self) -> Vec<AuditEvent> {
        let mut inner = self.inner.lock().expect("harness mutex poisoned");
        std::mem::take(&mut inner.audit_log)
    }

    fn evaluate_policies(&self, intercept: &Intercept) -> PolicyDecision {
        let mut inner = self.inner.lock().expect("harness mutex poisoned");

        // First pass: collect policies that match (pillar/operation filter).
        // We clone the relevant fields so we don't hold an immutable borrow
        // of `inner.policies` while mutating `inner.rate_limit_state` below.
        let matching: Vec<(String, PolicyKind, serde_json::Value, String)> = inner
            .policies
            .iter()
            .filter(|policy| {
                if let Some(p) = &policy.pillar {
                    if p != intercept.pillar.as_str() {
                        return false;
                    }
                }
                if let Some(op) = &policy.operation {
                    if op != &intercept.operation {
                        return false;
                    }
                }
                true
            })
            .map(|p| (p.id.clone(), p.kind, p.params.clone(), p.reason.clone()))
            .collect();

        for (policy_id, kind, params, reason) in matching {
            match kind {
                PolicyKind::Boundary => {
                    return PolicyDecision {
                        allow: false,
                        policy: Some(policy_id.clone()),
                        reason: format!("boundary policy '{}' forbids this: {}", policy_id, reason),
                    };
                }
                PolicyKind::RateLimit => {
                    let window_ms = params.get("windowMs")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(60_000);
                    let max = params.get("max")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(100);
                    let key = format!("{}:{}:{}", policy_id, intercept.pillar.as_str(), intercept.operation);
                    let now = Instant::now();
                    let state = inner.rate_limit_state.entry(key.clone()).or_insert(RateLimitState {
                        count: 0,
                        window_start: now,
                    });
                    if now.duration_since(state.window_start) > Duration::from_millis(window_ms) {
                        state.count = 1;
                        state.window_start = now;
                    } else {
                        state.count += 1;
                        if state.count > max {
                            return PolicyDecision {
                                allow: false,
                                policy: Some(policy_id.clone()),
                                reason: format!("rate_limit '{}' exceeded: {}/{} in {}ms",
                                    policy_id, state.count, max, window_ms),
                            };
                        }
                    }
                }
                PolicyKind::RequireLocal => {
                    if !intercept.metadata.as_ref()
                        .and_then(|m| m.require_local)
                        .unwrap_or(false)
                    {
                        return PolicyDecision {
                            allow: false,
                            policy: Some(policy_id.clone()),
                            reason: format!("require_local policy '{}' needs metadata.require_local=true", policy_id),
                        };
                    }
                }
                PolicyKind::Redaction | PolicyKind::Budget => {
                    // Handled at the TS layer for now (would need to return modified payload)
                }
            }
        }
        PolicyDecision {
            allow: true,
            reason: "all policies passed".to_string(),
            policy: None,
        }
    }

    fn log_audit(&self, event: AuditEvent) {
        let mut inner = self.inner.lock().expect("harness mutex poisoned");
        inner.audit_log.push(event);
    }
}

fn generate_trace_id() -> String {
    use std::time::SystemTime;
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("trc_{:x}", now)
}

fn now_ms() -> u64 {
    use std::time::SystemTime;
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn intercept_with_no_policies_succeeds() {
        let h = MetaHarness::new();
        let req = Intercept {
            pillar: Pillar::RevIke,
            operation: "reflex".to_string(),
            payload: serde_json::json!({"stimulus": "hello"}),
            metadata: None,
        };
        let result = h.intercept(&req);
        assert!(result.allowed);
        assert!(result.error.is_none());
    }

    #[test]
    fn boundary_policy_blocks() {
        let h = MetaHarness::new();
        h.load_policies(vec![Policy {
            id: "test-block".to_string(),
            kind: PolicyKind::Boundary,
            pillar: Some("goose".to_string()),
            operation: None,
            params: serde_json::json!({}),
            reason: "testing".to_string(),
        }]);
        let req = Intercept {
            pillar: Pillar::Goose,
            operation: "execute".to_string(),
            payload: serde_json::json!({}),
            metadata: None,
        };
        let result = h.intercept(&req);
        assert!(!result.allowed);
        match result.error.unwrap() {
            InterceptionError::PolicyViolation { policy, .. } => {
                assert_eq!(policy, "test-block");
            }
            _ => panic!("expected PolicyViolation"),
        }
    }

    #[test]
    fn rate_limit_enforced() {
        let h = MetaHarness::new();
        h.load_policies(vec![Policy {
            id: "test-rl".to_string(),
            kind: PolicyKind::RateLimit,
            pillar: Some("rev_ike".to_string()),
            operation: Some("reflex".to_string()),
            params: serde_json::json!({"windowMs": 60000, "max": 3}),
            reason: "testing".to_string(),
        }]);
        for _ in 0..3 {
            let req = Intercept {
                pillar: Pillar::RevIke,
                operation: "reflex".to_string(),
                payload: serde_json::json!({}),
                metadata: None,
            };
            assert!(h.intercept(&req).allowed);
        }
        // 4th should fail
        let req = Intercept {
            pillar: Pillar::RevIke,
            operation: "reflex".to_string(),
            payload: serde_json::json!({}),
            metadata: None,
        };
        assert!(!h.intercept(&req).allowed);
    }
}
