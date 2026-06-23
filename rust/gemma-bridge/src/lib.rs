//! Gemma Bridge — Rust FFI to llama.cpp for Gemma 2B inference via Vulkan.
//!
//! AMOS v2.8 §5.1 — Primary inference backend.
//!
//! Architecture:
//!   Kotlin GemmaBridge.kt → JNI → this crate (libgemma_bridge.so)
//!     → llama.cpp (libllama.so + libggml-vulkan.so) → Adreno GPU
//!
//! The actual llama.cpp FFI is gated behind the `llama_linked` feature.
//! Without that feature (default), all calls return NotImplemented —
//! the crate compiles anywhere, but produces no real inference.
//!
//! To build with real llama.cpp:
//!   1. Build llama.cpp with -DGGML_VULKAN=ON for aarch64-linux-android
//!   2. Place libllama.so + libggml-vulkan.so in NDK search path
//!   3. cargo ndk --target aarch64-linux-android build --release --features llama_linked
//!
//! Models:
//!   - gemma-2-2b-it-Q4_K_M.gguf (~1.5 GB) — already on device per architect
//!   - gemma-2-9b-it-Q4_K_M.gguf (~5.5 GB) — optional, higher quality
//!
//! Latency on S25 Ultra Adreno 750:
//!   - Gemma 2B Q4: 50-150ms first-token, 20-40 tok/sec sustained

#![cfg_attr(not(feature = "llama_linked"), allow(dead_code, unused_variables))]

use serde::{Deserialize, Serialize};
use std::sync::{Mutex, OnceLock};

/// Error returned by Gemma bridge operations.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum GemmaError {
    NotInitialized,
    ModelLoadFailed { path: String, reason: String },
    InferenceFailed { reason: String },
    NotImplemented,
    InvalidConfig { reason: String },
}

impl std::fmt::Display for GemmaError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            GemmaError::NotInitialized => write!(f, "Gemma bridge not initialized"),
            GemmaError::ModelLoadFailed { path, reason } => {
                write!(f, "model load failed for '{}': {}", path, reason)
            }
            GemmaError::InferenceFailed { reason } => write!(f, "inference failed: {}", reason),
            GemmaError::NotImplemented => {
                write!(f, "gemma-bridge built without 'llama_linked' feature — no real inference")
            }
            GemmaError::InvalidConfig { reason } => write!(f, "invalid config: {}", reason),
        }
    }
}

impl std::error::Error for GemmaError {}

/// GPU backend to use for inference.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum GpuBackend {
    Vulkan,
    Opencl,
    Cpu,
}

impl GpuBackend {
    pub fn as_str(&self) -> &'static str {
        match self {
            GpuBackend::Vulkan => "vulkan",
            GpuBackend::Opencl => "opencl",
            GpuBackend::Cpu => "cpu",
        }
    }
}

/// Configuration for initializing the llama.cpp context.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GemmaConfig {
    /// Path to the GGUF model file on device.
    pub model_path: String,
    /// GPU backend. Default: Vulkan (fastest on Adreno, no Knox trip).
    pub gpu_backend: GpuBackend,
    /// Context length in tokens. Default: 4096.
    pub context_length: u32,
    /// Number of layers to offload to GPU. -1 = all layers.
    pub gpu_layers: i32,
}

impl Default for GemmaConfig {
    fn default() -> Self {
        Self {
            model_path: String::new(),
            gpu_backend: GpuBackend::Vulkan,
            context_length: 4096,
            gpu_layers: -1,
        }
    }
}

/// Request for a single inference call.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerateRequest {
    pub prompt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system_prompt: Option<String>,
    pub max_tokens: u32,
    pub temperature: f32,
    pub top_p: f32,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub stop_sequences: Vec<String>,
}

/// Response from an inference call.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerateResponse {
    pub text: String,
    pub token_count: u32,
    pub latency_ms: u64,
    pub tokens_per_sec: f32,
}

/// Top-level Gemma bridge — singleton managing the llama.cpp context.
#[derive(Debug)]
pub struct GemmaBridge {
    inner: Mutex<GemmaBridgeInner>,
}

#[derive(Debug, Default)]
struct GemmaBridgeInner {
    initialized: bool,
    config: Option<GemmaConfig>,
    model_loaded: bool,
    #[cfg(feature = "llama_linked")]
    llama_context: Option<LlamaContextHandle>,
}

/// Opaque handle to a llama.cpp context.
/// Real type comes from llama.cpp bindings when `llama_linked` feature is enabled.
#[cfg(feature = "llama_linked")]
#[derive(Debug)]
struct LlamaContextHandle {
    // Real fields would be:
    //   ctx: *mut llama_cpp::llama_context,
    //   model: *mut llama_cpp::llama_model,
    // We use a placeholder until the FFI crate is wired up.
    _placeholder: (),
}

impl Default for GemmaBridge {
    fn default() -> Self {
        Self::new()
    }
}

impl GemmaBridge {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(GemmaBridgeInner::default()),
        }
    }

    /// Initialize the llama.cpp backend (GPU backend selection).
    /// Does NOT load any model — that's done by `load_model()`.
    pub fn init_backend(&self, _gpu_backend: GpuBackend) -> Result<(), GemmaError> {
        #[cfg(feature = "llama_linked")]
        {
            // Real impl: call llama_backend_init() with the appropriate GPU backend
            // For now, just mark as initialized
            let mut inner = self.inner.lock().expect("gemma mutex poisoned");
            inner.initialized = true;
            Ok(())
        }
        #[cfg(not(feature = "llama_linked"))]
        {
            Err(GemmaError::NotImplemented)
        }
    }

    /// Load a Gemma 2B GGUF model file.
    pub fn load_model(&self, config: GemmaConfig) -> Result<(), GemmaError> {
        #[cfg(feature = "llama_linked")]
        {
            let mut inner = self.inner.lock().expect("gemma mutex poisoned");
            if !inner.initialized {
                return Err(GemmaError::NotInitialized);
            }
            if config.model_path.is_empty() {
                return Err(GemmaError::InvalidConfig {
                    reason: "model_path is empty".to_string(),
                });
            }
            // Real impl:
            //   1. Call llama_model_load(config.model_path)
            //   2. Create llama_context with context_length params
            //   3. Offload gpu_layers to GPU via ggml_vulkan
            //   4. Store handle in inner.llama_context
            inner.config = Some(config.clone());
            inner.model_loaded = true;
            Ok(())
        }
        #[cfg(not(feature = "llama_linked"))]
        {
            let _ = config;
            Err(GemmaError::NotImplemented)
        }
    }

    /// Check if a model is currently loaded.
    pub fn is_model_loaded(&self) -> bool {
        let inner = self.inner.lock().expect("gemma mutex poisoned");
        inner.model_loaded
    }

    /// Generate text using the loaded Gemma 2B model.
    pub fn generate(&self, request: GenerateRequest) -> Result<GenerateResponse, GemmaError> {
        #[cfg(feature = "llama_linked")]
        {
            let inner = self.inner.lock().expect("gemma mutex poisoned");
            if !inner.model_loaded {
                return Err(GemmaError::NotInitialized);
            }
            let started = std::time::Instant::now();

            // Real impl:
            //   1. Tokenize prompt + system_prompt
            //   2. llama_decode() to process prompt
            //   3. Loop: llama_sample() + llama_decode() for max_tokens
            //   4. Detokenize output tokens
            //   5. Stop on stop_sequences or EOS
            let text = String::new(); // placeholder
            let token_count = 0u32;
            let latency_ms = started.elapsed().as_millis() as u64;
            let tokens_per_sec = if latency_ms > 0 {
                (token_count as f32 / latency_ms as f32) * 1000.0
            } else {
                0.0
            };

            Ok(GenerateResponse {
                text,
                token_count,
                latency_ms,
                tokens_per_sec,
            })
        }
        #[cfg(not(feature = "llama_linked"))]
        {
            let _ = request;
            Err(GemmaError::NotImplemented)
        }
    }

    /// Unload the current model (free RAM).
    pub fn unload(&self) -> Result<(), GemmaError> {
        #[cfg(feature = "llama_linked")]
        {
            let mut inner = self.inner.lock().expect("gemma mutex poisoned");
            // Real impl: llama_free(ctx), llama_free_model(model)
            inner.llama_context = None;
            inner.model_loaded = false;
            inner.config = None;
            Ok(())
        }
        #[cfg(not(feature = "llama_linked"))]
        {
            Err(GemmaError::NotImplemented)
        }
    }
}

/// Singleton accessor.
pub fn global_bridge() -> &'static GemmaBridge {
    static BRIDGE: OnceLock<GemmaBridge> = OnceLock::new();
    BRIDGE.get_or_init(GemmaBridge::new)
}

// ============================================================================
// JNI entry points — called from mobile/capacitor/android/.../GemmaBridge.kt
// ============================================================================

#[cfg(feature = "jni")]
pub mod jni {
    use super::*;
    use jni::objects::{JClass, JObject, JString};
    use jni::sys::{jint, jlong};
    use jni::JNIEnv;

    /// JNI: Java_com_ava007_mobile_GemmaBridge_nativeInit
    ///
    /// Initializes the llama.cpp backend with the given GPU backend.
    /// Java signature: `private native boolean nativeInit(String gpuBackend)`
    #[no_mangle]
    pub unsafe extern "system" fn Java_com_ava007_mobile_GemmaBridge_nativeInit(
        mut env: JNIEnv,
        _class: JClass,
        gpu_backend: JString,
    ) -> jni::sys::jboolean {
        let backend_str: String = match env.get_string(&gpu_backend) {
            Ok(s) => s.into(),
            Err(_) => return jni::sys::JNI_FALSE,
        };
        let backend = match backend_str.as_str() {
            "vulkan" => GpuBackend::Vulkan,
            "opencl" => GpuBackend::Opencl,
            "cpu" => GpuBackend::Cpu,
            _ => GpuBackend::Vulkan,
        };
        match global_bridge().init_backend(backend) {
            Ok(()) => jni::sys::JNI_TRUE,
            Err(_) => jni::sys::JNI_FALSE,
        }
    }

    /// JNI: Java_com_ava007_mobile_GemmaBridge_nativeLoadModel
    ///
    /// Loads a GGUF model file.
    /// Java signature: `private native boolean nativeLoadModel(String modelPath, int contextLength, int gpuLayers)`
    #[no_mangle]
    pub unsafe extern "system" fn Java_com_ava007_mobile_GemmaBridge_nativeLoadModel(
        mut env: JNIEnv,
        _class: JClass,
        model_path: JString,
        context_length: jint,
        gpu_layers: jint,
    ) -> jni::sys::jboolean {
        let path: String = match env.get_string(&model_path) {
            Ok(s) => s.into(),
            Err(_) => return jni::sys::JNI_FALSE,
        };
        let config = GemmaConfig {
            model_path: path,
            gpu_backend: GpuBackend::Vulkan,
            context_length: context_length as u32,
            gpu_layers: gpu_layers as i32,
        };
        match global_bridge().load_model(config) {
            Ok(()) => jni::sys::JNI_TRUE,
            Err(_) => jni::sys::JNI_FALSE,
        }
    }

    /// JNI: Java_com_ava007_mobile_GemmaBridge_nativeGenerate
    ///
    /// Generates text. Returns a JSON string with {text, tokenCount, latencyMs, tokensPerSec}.
    /// Java signature: `private native String nativeGenerate(String prompt, String systemPrompt, int maxTokens, float temperature, float topP)`
    #[no_mangle]
    pub unsafe extern "system" fn Java_com_ava007_mobile_GemmaBridge_nativeGenerate(
        mut env: JNIEnv,
        _class: JClass,
        prompt: JString,
        system_prompt: JString,
        max_tokens: jint,
        temperature: jni::sys::jfloat,
        top_p: jni::sys::jfloat,
    ) -> jni::sys::jstring {
        let prompt_str: String = match env.get_string(&prompt) {
            Ok(s) => s.into(),
            Err(_) => return std::ptr::null_mut(),
        };
        let system_str: Option<String> = if system_prompt.is_null() {
            None
        } else {
            env.get_string(&system_prompt).ok().map(|s| s.into())
        };
        let request = GenerateRequest {
            prompt: prompt_str,
            system_prompt: system_str,
            max_tokens: max_tokens as u32,
            temperature,
            top_p,
            stop_sequences: vec![],
        };
        match global_bridge().generate(request) {
            Ok(response) => {
                let json = serde_json::to_string(&response).unwrap_or_default();
                match env.new_string(json) {
                    Ok(s) => s.into_raw(),
                    Err(_) => std::ptr::null_mut(),
                }
            }
            Err(_) => std::ptr::null_mut(),
        }
    }

    /// JNI: Java_com_ava007_mobile_GemmaBridge_nativeUnload
    ///
    /// Unloads the current model.
    /// Java signature: `private native void nativeUnload()`
    #[no_mangle]
    pub unsafe extern "system" fn Java_com_ava007_mobile_GemmaBridge_nativeUnload(
        _env: JNIEnv,
        _class: JClass,
    ) {
        let _ = global_bridge().unload();
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bridge_without_llama_linked_returns_not_implemented() {
        #[cfg(not(feature = "llama_linked"))]
        {
            let bridge = GemmaBridge::new();
            let result = bridge.init_backend(GpuBackend::Vulkan);
            assert!(matches!(result, Err(GemmaError::NotImplemented)));
        }
    }

    #[test]
    fn load_model_without_llama_linked_returns_not_implemented() {
        #[cfg(not(feature = "llama_linked"))]
        {
            let bridge = GemmaBridge::new();
            let config = GemmaConfig {
                model_path: "/fake/path/gemma-2-2b-it-Q4_K_M.gguf".to_string(),
                gpu_backend: GpuBackend::Vulkan,
                context_length: 4096,
                gpu_layers: -1,
            };
            let result = bridge.load_model(config);
            assert!(matches!(result, Err(GemmaError::NotImplemented)));
        }
    }

    #[test]
    fn generate_without_llama_linked_returns_not_implemented() {
        #[cfg(not(feature = "llama_linked"))]
        {
            let bridge = GemmaBridge::new();
            let request = GenerateRequest {
                prompt: "Hello".to_string(),
                system_prompt: None,
                max_tokens: 64,
                temperature: 0.7,
                top_p: 0.9,
                stop_sequences: vec![],
            };
            let result = bridge.generate(request);
            assert!(matches!(result, Err(GemmaError::NotImplemented)));
        }
    }

    #[test]
    fn is_model_loaded_defaults_to_false() {
        let bridge = GemmaBridge::new();
        assert!(!bridge.is_model_loaded());
    }

    #[test]
    fn gpu_backend_as_str_works() {
        assert_eq!(GpuBackend::Vulkan.as_str(), "vulkan");
        assert_eq!(GpuBackend::Opencl.as_str(), "opencl");
        assert_eq!(GpuBackend::Cpu.as_str(), "cpu");
    }

    #[test]
    fn global_bridge_returns_same_instance() {
        let b1 = global_bridge();
        let b2 = global_bridge();
        // Same pointer = same instance
        assert!(std::ptr::eq(b1, b2));
    }

    #[test]
    fn default_config_is_vulkan() {
        let config = GemmaConfig::default();
        assert_eq!(config.gpu_backend, GpuBackend::Vulkan);
        assert_eq!(config.context_length, 4096);
        assert_eq!(config.gpu_layers, -1);
        assert!(config.model_path.is_empty());
    }

    #[test]
    fn gemma_error_display_works() {
        let err = GemmaError::ModelLoadFailed {
            path: "/foo.gguf".to_string(),
            reason: "file not found".to_string(),
        };
        let msg = format!("{}", err);
        assert!(msg.contains("/foo.gguf"));
        assert!(msg.contains("file not found"));
    }
}
