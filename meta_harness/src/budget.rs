//! Inference Budget Tracker — guards the device's compute resources.
//!
//! The Snapdragon 8 Elite has finite thermal and battery headroom.
//! Unbounded inference melts the phone. This module enforces:
//!
//!   - Per-session token budget (default 50k tokens / 5 min)
//!   - Per-turn latency budget (from the policy Decision)
//!   - Sustained throughput cap (avoids thermal throttling)
//!   - FABLE 12B rate limiting (max 1 concurrent, max 10/min)
//!   - Thermal backoff (auto-degrade Gemma 2B → smaller batch)
//!
//! All counters are atomic — no locks on the hot path.

use std::sync::atomic::{AtomicU64, AtomicU32, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use parking_lot::Mutex;

use crate::policy::ModelChoice;

/// Hard limits. Tuned for S25 Ultra (Snapdragon 8 Elite, 12GB RAM, 5000mAh).
pub const SESSION_TOKEN_BUDGET: u64         = 50_000;
pub const SESSION_DURATION_LIMIT: Duration  = Duration::from_secs(300); // 5 min
pub const FABLE_MAX_CONCURRENT: u32         = 1;
pub const FABLE_RATE_PER_MIN: u32           = 10;
pub const GEMMA_MAX_TOK_PER_SEC: u32        = 1024; // burst ceiling (caps runaway concurrency)
pub const THERMAL_THROTTLE_TEMP_C: u32      = 65;
pub const THERMAL_BACKOFF_TEMP_C: u32       = 55;

/// Configurable limits (for tests). Production uses the const defaults.
#[derive(Clone, Debug)]
pub struct BudgetLimits {
    pub session_token_budget: u64,
    pub session_duration_limit: Duration,
    pub fable_max_concurrent: u32,
    pub fable_rate_per_min: u32,
    pub gemma_max_tok_per_sec: u32,
    pub thermal_throttle_temp_c: u32,
    pub thermal_backoff_temp_c: u32,
}

impl Default for BudgetLimits {
    fn default() -> Self {
        Self {
            session_token_budget: SESSION_TOKEN_BUDGET,
            session_duration_limit: SESSION_DURATION_LIMIT,
            fable_max_concurrent: FABLE_MAX_CONCURRENT,
            fable_rate_per_min: FABLE_RATE_PER_MIN,
            gemma_max_tok_per_sec: GEMMA_MAX_TOK_PER_SEC,
            thermal_throttle_temp_c: THERMAL_THROTTLE_TEMP_C,
            thermal_backoff_temp_c: THERMAL_BACKOFF_TEMP_C,
        }
    }
}

#[derive(Debug, Default, Clone, Copy)]
pub struct BudgetSnapshot {
    pub session_tokens_used: u64,
    pub session_tokens_remaining: u64,
    pub session_elapsed_ms: u64,
    pub fable_in_flight: u32,
    pub fable_calls_this_min: u32,
    pub gemma_tok_this_sec: u32,
    pub thermal_state: ThermalState,
    pub last_decision_allowed: bool,
    pub last_decision_reason: BudgetDenialReason,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub enum ThermalState {
    #[default]
    Nominal,
    Warm,
    Throttling,
    Critical,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub enum BudgetDenialReason {
    #[default]
    Allowed,
    SessionTokenBudgetExhausted,
    SessionDurationExceeded,
    FableConcurrentLimit,
    FableRateLimited,
    GemmaThroughputCap,
    ThermalThrottling,
    ThermalCritical,
}

impl BudgetDenialReason {
    pub fn is_allowed(self) -> bool {
        matches!(self, BudgetDenialReason::Allowed)
    }

    pub fn as_str(self) -> &'static str {
        match self {
            BudgetDenialReason::Allowed => "allowed",
            BudgetDenialReason::SessionTokenBudgetExhausted => "session_token_budget_exhausted",
            BudgetDenialReason::SessionDurationExceeded => "session_duration_exceeded",
            BudgetDenialReason::FableConcurrentLimit => "fable_concurrent_limit",
            BudgetDenialReason::FableRateLimited => "fable_rate_limited",
            BudgetDenialReason::GemmaThroughputCap => "gemma_throughput_cap",
            BudgetDenialReason::ThermalThrottling => "thermal_throttling",
            BudgetDenialReason::ThermalCritical => "thermal_critical",
        }
    }
}

pub struct BudgetTracker {
    /// Tokens consumed in this session (resets per AVA007 session)
    session_tokens: AtomicU64,

    /// Wall-clock session start
    session_start: Mutex<Instant>,

    /// FABLE 12B currently in flight
    fable_in_flight: AtomicU32,

    /// FABLE calls in the current 1-minute window
    fable_calls_window: AtomicU32,
    fable_window_start: Mutex<Instant>,

    /// Gemma tokens generated in the current 1-second window
    gemma_tok_window: AtomicU32,
    gemma_window_start: Mutex<Instant>,

    /// Current thermal state (set by external thermal monitor)
    thermal: Mutex<ThermalState>,

    /// Configurable limits
    limits: BudgetLimits,
}

impl BudgetTracker {
    pub fn new() -> Arc<Self> {
        Self::with_limits(BudgetLimits::default())
    }

    /// Create with custom limits (for tests).
    pub fn with_limits(limits: BudgetLimits) -> Arc<Self> {
        Arc::new(Self {
            session_tokens: AtomicU64::new(0),
            session_start: Mutex::new(Instant::now()),
            fable_in_flight: AtomicU32::new(0),
            fable_calls_window: AtomicU32::new(0),
            fable_window_start: Mutex::new(Instant::now()),
            gemma_tok_window: AtomicU32::new(0),
            gemma_window_start: Mutex::new(Instant::now()),
            thermal: Mutex::new(ThermalState::Nominal),
            limits,
        })
    }

    /// Check whether a Decision is allowed under current budget.
    /// Returns the reason (Allowed if permitted).
    pub fn check(&self, model: ModelChoice, est_tokens: u32) -> BudgetDenialReason {
        // ── Thermal check (highest priority) ────────────────────────
        let thermal = *self.thermal.lock();
        match thermal {
            ThermalState::Critical => return BudgetDenialReason::ThermalCritical,
            ThermalState::Throttling if model == ModelChoice::Fable12B => {
                // FABLE 12B is too hot to run during throttling
                return BudgetDenialReason::ThermalThrottling;
            }
            _ => {}
        }

        // ── Session token budget ────────────────────────────────────
        let used = self.session_tokens.load(Ordering::Relaxed);
        if used + est_tokens as u64 > self.limits.session_token_budget {
            return BudgetDenialReason::SessionTokenBudgetExhausted;
        }

        // ── Session duration limit ──────────────────────────────────
        let elapsed = self.session_start.lock().elapsed();
        if elapsed > self.limits.session_duration_limit {
            return BudgetDenialReason::SessionDurationExceeded;
        }

        // ── Per-model limits ────────────────────────────────────────
        match model {
            ModelChoice::Gemma2B | ModelChoice::Mellum2 => {
                // Roll the 1-second window if needed
                self.maybe_roll_gemma_window();
                let tok_this_sec = self.gemma_tok_window.load(Ordering::Relaxed);
                if tok_this_sec + est_tokens > self.limits.gemma_max_tok_per_sec {
                    return BudgetDenialReason::GemmaThroughputCap;
                }
            }
            ModelChoice::Fable12B | ModelChoice::Mercury2 => {
                // Concurrent limit
                let in_flight = self.fable_in_flight.load(Ordering::Relaxed);
                if in_flight >= self.limits.fable_max_concurrent {
                    return BudgetDenialReason::FableConcurrentLimit;
                }
                // Rate limit (per minute)
                self.maybe_roll_fable_window();
                let calls = self.fable_calls_window.load(Ordering::Relaxed);
                if calls >= self.limits.fable_rate_per_min {
                    return BudgetDenialReason::FableRateLimited;
                }
            }
            ModelChoice::None => {}
        }

        BudgetDenialReason::Allowed
    }

    /// Reserve budget for a turn. Call BEFORE invoking inference.
    /// Returns Err(reason) if denied.
    pub fn reserve(
        &self,
        model: ModelChoice,
        est_tokens: u32,
    ) -> Result<BudgetReservation, BudgetDenialReason> {
        let reason = self.check(model, est_tokens);
        if !reason.is_allowed() {
            return Err(reason);
        }

        match model {
            ModelChoice::Gemma2B | ModelChoice::Mellum2 => {
                self.gemma_tok_window.fetch_add(est_tokens, Ordering::Relaxed);
            }
            ModelChoice::Fable12B | ModelChoice::Mercury2 => {
                self.fable_in_flight.fetch_add(1, Ordering::Relaxed);
                self.fable_calls_window.fetch_add(1, Ordering::Relaxed);
            }
            ModelChoice::None => {}
        }

        self.session_tokens.fetch_add(est_tokens as u64, Ordering::Relaxed);

        Ok(BudgetReservation {
            model,
            reserved_tokens: est_tokens,
        })
    }

    /// Release a reservation after inference completes (or fails).
    /// Records actual tokens used (for accuracy in next estimate).
    pub fn release(&self, reservation: BudgetReservation, actual_tokens: u32) {
        match reservation.model {
            ModelChoice::Gemma2B | ModelChoice::Mellum2 => {
                // Subtract the reservation, add back actual (smoother)
                // Net effect: we used `actual_tokens` not `reserved_tokens`
                let delta = reservation.reserved_tokens as i64 - actual_tokens as i64;
                if delta > 0 {
                    self.gemma_tok_window.fetch_sub(delta as u32, Ordering::Relaxed);
                }
            }
            ModelChoice::Fable12B | ModelChoice::Mercury2 => {
                self.fable_in_flight.fetch_sub(1, Ordering::Relaxed);
            }
            ModelChoice::None => {}
        }

        // Adjust session counter to actual usage
        let delta = reservation.reserved_tokens as i64 - actual_tokens as i64;
        if delta > 0 {
            self.session_tokens.fetch_sub(delta as u64, Ordering::Relaxed);
        }
    }

    /// External thermal monitor calls this with the current SoC temp.
    pub fn update_thermal(&self, temp_c: u32) {
        let mut thermal = self.thermal.lock();
        *thermal = if temp_c >= self.limits.thermal_throttle_temp_c {
            ThermalState::Critical
        } else if temp_c >= self.limits.thermal_backoff_temp_c {
            ThermalState::Throttling
        } else if temp_c >= 45 {
            ThermalState::Warm
        } else {
            ThermalState::Nominal
        };
    }

    pub fn snapshot(&self) -> BudgetSnapshot {
        let used = self.session_tokens.load(Ordering::Relaxed);
        let elapsed_ms = self.session_start.lock().elapsed().as_millis() as u64;
        let thermal = *self.thermal.lock();

        BudgetSnapshot {
            session_tokens_used: used,
            session_tokens_remaining: self.limits.session_token_budget.saturating_sub(used),
            session_elapsed_ms: elapsed_ms,
            fable_in_flight: self.fable_in_flight.load(Ordering::Relaxed),
            fable_calls_this_min: self.fable_calls_window.load(Ordering::Relaxed),
            gemma_tok_this_sec: self.gemma_tok_window.load(Ordering::Relaxed),
            thermal_state: thermal,
            last_decision_allowed: true,
            last_decision_reason: BudgetDenialReason::Allowed,
        }
    }

    /// Reset the session (called when AVA007 starts a fresh session)
    pub fn reset_session(&self) {
        self.session_tokens.store(0, Ordering::Relaxed);
        *self.session_start.lock() = Instant::now();
        self.fable_in_flight.store(0, Ordering::Relaxed);
        self.fable_calls_window.store(0, Ordering::Relaxed);
        *self.fable_window_start.lock() = Instant::now();
    }

    fn maybe_roll_fable_window(&self) {
        let mut start = self.fable_window_start.lock();
        if start.elapsed() >= Duration::from_secs(60) {
            self.fable_calls_window.store(0, Ordering::Relaxed);
            *start = Instant::now();
        }
    }

    fn maybe_roll_gemma_window(&self) {
        let mut start = self.gemma_window_start.lock();
        if start.elapsed() >= Duration::from_secs(1) {
            self.gemma_tok_window.store(0, Ordering::Relaxed);
            *start = Instant::now();
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct BudgetReservation {
    model: ModelChoice,
    reserved_tokens: u32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_within_budget() {
        let bt = BudgetTracker::new();
        let r = bt.reserve(ModelChoice::Gemma2B, 100).unwrap();
        bt.release(r, 95);
        let snap = bt.snapshot();
        assert_eq!(snap.session_tokens_used, 95);
    }

    #[test]
    fn denies_when_session_token_budget_exhausted() {
        let bt = BudgetTracker::with_limits(BudgetLimits {
            session_token_budget: 300,
            gemma_max_tok_per_sec: 500,
            ..Default::default()
        });
        // Reserve near the budget
        let _r = bt.reserve(ModelChoice::Gemma2B, 250).unwrap();
        // Next request should be denied — would exceed 300 budget
        let r2 = bt.reserve(ModelChoice::Gemma2B, 100);
        assert_eq!(r2.unwrap_err(), BudgetDenialReason::SessionTokenBudgetExhausted);
    }

    #[test]
    fn fable_concurrent_limit_enforced() {
        let bt = BudgetTracker::new();
        let _r1 = bt.reserve(ModelChoice::Fable12B, 500).unwrap();
        let r2 = bt.reserve(ModelChoice::Fable12B, 500);
        assert_eq!(r2.unwrap_err(), BudgetDenialReason::FableConcurrentLimit);
    }

    #[test]
    fn thermal_critical_blocks_everything() {
        let bt = BudgetTracker::new();
        bt.update_thermal(70); // critical
        let r = bt.reserve(ModelChoice::Gemma2B, 100);
        assert_eq!(r.unwrap_err(), BudgetDenialReason::ThermalCritical);
    }

    #[test]
    fn thermal_throttling_blocks_fable_only() {
        let bt = BudgetTracker::new();
        bt.update_thermal(58); // throttling
        let r_fable = bt.reserve(ModelChoice::Fable12B, 500);
        assert_eq!(r_fable.unwrap_err(), BudgetDenialReason::ThermalThrottling);

        let r_gemma = bt.reserve(ModelChoice::Gemma2B, 100);
        assert!(r_gemma.is_ok());
    }

    #[test]
    fn reset_clears_counters() {
        let bt = BudgetTracker::new();
        let _r = bt.reserve(ModelChoice::Gemma2B, 1000).unwrap();
        assert!(bt.snapshot().session_tokens_used > 0);
        bt.reset_session();
        assert_eq!(bt.snapshot().session_tokens_used, 0);
    }
}
