// Placeholder — Constellation model router (AMOS v2.1)
// Routes inference requests to optimal model/backend based on budget.

#![allow(unused)]

pub struct RoutingRequest {
    pub prompt: String,
    pub max_latency_ms: u32,
    pub max_battery_pct: f32,
    pub require_local: bool,
}

pub struct RoutingDecision {
    pub backend: Backend,
    pub model_id: String,
    pub quantization: Quantization,
    pub estimated_latency_ms: u32,
}

#[derive(Debug, Clone, Copy)]
pub enum Backend {
    QnnNpu,      // Hexagon NPU via QNN
    WebGpu,      // Adreno GPU via WebGPU
    Cpu,         // CPU fallback
    Llamdrop,    // llamdrop local
    Cloud,       // Cloud fallback (only if require_local == false)
}

#[derive(Debug, Clone, Copy)]
pub enum Quantization {
    Q0f32,
    Q4f16,
    Q4f32,
    TMan1_58,    // 1.58-bit T-MAN
}

/// Select the optimal model/backend for a routing request.
pub fn route(_req: &RoutingRequest) -> Result<RoutingDecision, RoutingError> {
    // TODO: implement budget-aware routing
    Err(RoutingError::NotImplemented)
}

#[derive(Debug)]
pub enum RoutingError {
    NotImplemented,
    NoBackendAvailable,
    BudgetExceeded,
}
