//! QNN Bridge — Qualcomm Neural Network NPU bridge for AMOS Mobile Runtime.
//!
//! Wraps the QNN SDK for Hexagon NPU inference on Snapdragon 8 Elite.
//! Built as a `cdylib` so it can be loaded via JNI from Kotlin
//! (`QNNPlugin.kt` in mobile/capacitor/android/).
//!
//! Real implementation requires the QNN SDK to be installed
//! (`$QNN_SDK_DIR`) and `qnn-sys` crate to provide FFI bindings.
//! This file provides the safe Rust API surface; FFI calls are gated
//! behind a `qnn_sdk` feature flag.

#![cfg_attr(not(feature = "qnn_sdk"), allow(dead_code, unused_variables))]

use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};

/// Error returned by QNN operations.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum QnnError {
    NpuUnavailable,
    ModelLoadFailed { reason: String },
    InferenceFailed { reason: String },
    InvalidInput { reason: String },
    SdkNotInitialized,
    #[cfg(not(feature = "qnn_sdk"))]
    NotImplemented,
}

impl std::fmt::Display for QnnError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            QnnError::NpuUnavailable => write!(f, "Hexagon NPU not available on this device"),
            QnnError::ModelLoadFailed { reason } => write!(f, "QNN model load failed: {}", reason),
            QnnError::InferenceFailed { reason } => write!(f, "QNN inference failed: {}", reason),
            QnnError::InvalidInput { reason } => write!(f, "QNN invalid input: {}", reason),
            QnnError::SdkNotInitialized => write!(f, "QNN SDK not initialized"),
            #[cfg(not(feature = "qnn_sdk"))]
            QnnError::NotImplemented => write!(f, "QNN bridge built without qnn_sdk feature"),
        }
    }
}

impl std::error::Error for QnnError {}

/// Configuration for a QNN inference session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QnnConfig {
    /// Path to the QNN model binary (e.g. `models/qnn/gemma_qnn.bin`)
    pub model_path: String,
    /// Device ID (default: 0 — first NPU)
    pub device_id: u32,
    /// Whether to use signed DSP (true) or unsigned HTP (false)
    pub use_signed_dsp: bool,
    /// Max RPC retry count
    pub max_retries: u32,
}

impl Default for QnnConfig {
    fn default() -> Self {
        Self {
            model_path: String::new(),
            device_id: 0,
            use_signed_dsp: true,
            max_retries: 3,
        }
    }
}

/// QNN inference session. Created by `QnnBridge::load_model`.
#[derive(Debug)]
pub struct QnnSession {
    config: QnnConfig,
    #[cfg(feature = "qnn_sdk")]
    inner: qnn_sys::QnnHandle,
}

impl QnnSession {
    /// Run inference on the loaded model.
    ///
    /// `input` is a flat vector of f32 values. The shape is determined
    /// by the model's input tensor spec (queried via `input_shape()`).
    pub fn infer(&self, input: &[f32]) -> Result<Vec<f32>, QnnError> {
        #[cfg(feature = "qnn_sdk")]
        {
            // Real impl: convert f32 -> quantized QNN tensor, run inference,
            // dequantize output back to f32.
            self.inner.infer(input).map_err(|e| QnnError::InferenceFailed { reason: e.to_string() })
        }
        #[cfg(not(feature = "qnn_sdk"))]
        {
            let _ = input;
            Err(QnnError::NotImplemented)
        }
    }

    /// Get the model's input tensor shape (e.g. `[1, 1024]` for a
    /// 1024-dim embedding input).
    pub fn input_shape(&self) -> Vec<usize> {
        #[cfg(feature = "qnn_sdk")]
        {
            self.inner.input_shape()
        }
        #[cfg(not(feature = "qnn_sdk"))]
        {
            vec![]
        }
    }

    /// Get the model's output tensor shape.
    pub fn output_shape(&self) -> Vec<usize> {
        #[cfg(feature = "qnn_sdk")]
        {
            self.inner.output_shape()
        }
        #[cfg(not(feature = "qnn_sdk"))]
        {
            vec![]
        }
    }

    pub fn config(&self) -> &QnnConfig {
        &self.config
    }
}

/// Top-level QNN bridge — singleton that manages the NPU device.
#[derive(Debug)]
pub struct QnnBridge {
    inner: Arc<Mutex<QnnBridgeInner>>,
}

#[derive(Debug, Default)]
struct QnnBridgeInner {
    available: bool,
    initialized: bool,
}

impl QnnBridge {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(QnnBridgeInner {
                available: detect_npu(),
                initialized: false,
            })),
        }
    }

    /// Check if a Hexagon NPU is available on this device.
    pub fn is_available(&self) -> bool {
        let inner = self.inner.lock().expect("qnn mutex poisoned");
        inner.available
    }

    /// Initialize the QNN SDK. Must be called before `load_model`.
    pub fn init(&self) -> Result<(), QnnError> {
        let mut inner = self.inner.lock().expect("qnn mutex poisoned");
        if !inner.available {
            return Err(QnnError::NpuUnavailable);
        }
        #[cfg(feature = "qnn_sdk")]
        {
            qnn_sys::init().map_err(|e| QnnError::SdkNotInitialized)?;
        }
        inner.initialized = true;
        Ok(())
    }

    /// Load a model and create an inference session.
    pub fn load_model(&self, config: QnnConfig) -> Result<QnnSession, QnnError> {
        let inner = self.inner.lock().expect("qnn mutex poisoned");
        if !inner.available {
            return Err(QnnError::NpuUnavailable);
        }
        if !inner.initialized {
            return Err(QnnError::SdkNotInitialized);
        }
        #[cfg(feature = "qnn_sdk")]
        {
            let handle = qnn_sys::load_model(&config.model_path, config.device_id)
                .map_err(|e| QnnError::ModelLoadFailed { reason: e.to_string() })?;
            Ok(QnnSession { config, inner: handle })
        }
        #[cfg(not(feature = "qnn_sdk"))]
        {
            Ok(QnnSession { config })
        }
    }
}

impl Default for QnnBridge {
    fn default() -> Self {
        Self::new()
    }
}

fn detect_npu() -> bool {
    // Real impl: check /sys/class/qcom,sde-dsi-0 or similar Android sysfs
    // For now: false unless qnn_sdk feature is enabled (which would only
    // happen on a real device build).
    cfg!(feature = "qnn_sdk")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bridge_without_sdk_reports_unavailable() {
        #[cfg(not(feature = "qnn_sdk"))]
        {
            let b = QnnBridge::new();
            assert!(!b.is_available());
        }
    }

    #[test]
    fn init_without_npu_fails() {
        let b = QnnBridge::new();
        if !b.is_available() {
            assert!(matches!(b.init(), Err(QnnError::NpuUnavailable)));
        }
    }
}
