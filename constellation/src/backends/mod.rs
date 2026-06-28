//! Constellation model backends — Mercury2 (diffusion) + Mellum2 (MoE).
//!
//! These fill the Cortex + Executive tiers from the white paper (§3).

pub mod mercury2;
pub mod mellum2;

pub use mercury2::{Mercury2Backend, mercury2_config};
pub use mellum2::{Mellum2Backend, mellum2_config};
