//! AVA007 — Constellation (Model Router)
//!
//! Constellation decides which model, which quantization, local or cloud,
//! for every single request. It never reasons. It only routes.
//!
//! # Input signals
//!   - Intent bucket (from REV.IKE classifier)
//!   - Confidence score
//!   - Complexity estimate (token count, entity count)
//!   - Battery level
//!   - Thermal state
//!   - Network connectivity (connected/degraded/offline)
//!   - Latency budget (from Policy)
//!   - Session budget remaining
//!
//! # Output: ModelAssignment
//!   - Which model
//!   - Which quantization
//!   - Local or cloud
//!   - Timeout
//!   - Fallback assignment (for retries)
//!
//! # Selection algorithm
//!   1. Hard constraints filter (thermal, battery, offline, health, context)
//!   2. Score remaining candidates (cost, latency, capability match)
//!   3. Pick top + set fallback
//!
//! # Model registry (defaults)
//!   Gemma 2B    Local   Q4_K_M  ~80ms   Reflex / classify / fast Q&A
//!   Gemma 4 12B Local   Q4_K_M  ~2s     Planning / synthesis / complex
//!   Embedding   Local   FP16    ~15ms   VSS recall / semantic search
//!   Claude      Cloud   N/A     ~1-3s   Complex reasoning fallback
//!   GPT-4o      Cloud   N/A     ~1-3s   Tool-use fallback
//!   Qwen 2.5 7B Local   Q4_K_M  ~150ms  Multilang fallback

use std::collections::HashMap;
use std::sync::Arc;

use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use tracing::{info, warn};

// ── Public API ──────────────────────────────────────────────────────────────

pub use model::*;
pub use router::*;
pub use signals::*;
pub use health::*;

mod model;
mod router;
mod signals;
mod health;

pub mod backends;
pub mod registry;

// Re-export for convenience
pub use crate::registry::default_registry;
