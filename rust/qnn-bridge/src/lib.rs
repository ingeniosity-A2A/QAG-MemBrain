// Placeholder — QNN NPU bridge
// Implements the QNN SDK calls invoked from qnn_jni.cpp

#![allow(unused)]

/// Check if Hexagon NPU is available on this device.
pub fn is_available() -> bool {
    // TODO: query QNN SDK
    false
}

/// Load a QNN model from the given path.
pub fn load_model(_path: &str) -> Result<(), QnnError> {
    // TODO: implement QNN model loading
    Err(QnnError::NotImplemented)
}

/// Run inference on the loaded model.
pub fn infer(_input: &[f32]) -> Result<Vec<f32>, QnnError> {
    // TODO: implement QNN inference
    Err(QnnError::NotImplemented)
}

#[derive(Debug)]
pub enum QnnError {
    NotImplemented,
    NpuUnavailable,
    ModelLoadFailed(String),
    InferenceFailed(String),
}
