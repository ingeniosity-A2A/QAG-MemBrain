//! Gemma Bridge — Rust FFI to llama.cpp for Gemma 2B inference via Vulkan.
//!
//! AMOS v2.8 §5.1 — Primary inference backend.
//!
//! Architecture:
//!   Kotlin GemmaBridge.kt → JNI → this crate (libgemma_bridge.so)
//!     → llama.cpp (libllama.so + libggml-vulkan.so) → Adreno GPU
//!
//! Features:
//!   - `default` — types only, no real FFI (compiles anywhere)
//!   - `jni` — enable JNI bindings for Android NDK
//!   - `llama_linked` — link to llama.cpp libllama.so + libggml-vulkan.so
//!                      (real inference; requires the libs to be present
//!                       at build time in NDK search path)
//!
//! To build with real inference:
//!   1. Build llama.cpp with -DGGML_VULKAN=ON for aarch64-linux-android
//!   2. Place libllama.so + libggml-vulkan.so in NDK search path
//!      (or set LLAMA_LIB_DIR env var)
//!   3. cargo ndk --target aarch64-linux-android --platform 21 build --release \
//!        --features jni,llama_linked
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

#[cfg(feature = "llama_linked")]
mod llama_ffi;

#[cfg(feature = "llama_linked")]
use llama_ffi as ffi;

/// Error returned by Gemma bridge operations.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum GemmaError {
    NotInitialized,
    ModelLoadFailed { path: String, reason: String },
    InferenceFailed { reason: String },
    NotImplemented,
    InvalidConfig { reason: String },
    TokenizationFailed { reason: String },
    DecodeFailed { reason: String },
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
            GemmaError::TokenizationFailed { reason } => write!(f, "tokenization failed: {}", reason),
            GemmaError::DecodeFailed { reason } => write!(f, "decode failed: {}", reason),
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
    /// Batch size for prompt processing. Default: 512.
    pub n_batch: u32,
    /// Number of threads for CPU computation. 0 = auto.
    pub n_threads: u32,
}

impl Default for GemmaConfig {
    fn default() -> Self {
        Self {
            model_path: String::new(),
            gpu_backend: GpuBackend::Vulkan,
            context_length: 4096,
            gpu_layers: -1,
            n_batch: 512,
            n_threads: 0,
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

// ============================================================================
// Backend state — only present when llama_linked is on
// ============================================================================

#[cfg(feature = "llama_linked")]
#[derive(Default)]
struct LlamaHandles {
    /// Raw pointer to llama_model. Owned; must call llama_model_free on shutdown.
    model: *mut ffi::llama_model,
    /// Raw pointer to llama_context. Owned; must call llama_free on shutdown.
    ctx: *mut ffi::llama_context,
    /// Pointer to vocab (not owned — borrowed from model).
    vocab: *const ffi::llama_vocab,
    /// BOS token id.
    bos_token: i32,
    /// EOS token id.
    eos_token: i32,
    /// Last config used.
    config: Option<GemmaConfig>,
}

// Safety: LlamaHandles contains raw pointers but is only accessed behind a Mutex.
#[cfg(feature = "llama_linked")]
unsafe impl Send for LlamaHandles {}
#[cfg(feature = "llama_linked")]
unsafe impl Sync for LlamaHandles {}

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
    handles: LlamaHandles,
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
            // llama_backend_init must be called once before any model loading.
            // The numa: false flag is standard for non-NUMA systems (mobile).
            let params = ffi::llama_backend_init_params { numa: false };
            unsafe { ffi::llama_backend_init(params) };

            let mut inner = self.inner.lock().expect("gemma mutex poisoned");
            inner.initialized = true;

            // Log system info for debugging
            unsafe {
                let sysinfo = ffi::llama_print_system_info();
                if !sysinfo.is_null() {
                    if let Some(s) = ffi::from_c_string(sysinfo) {
                        eprintln!("[gemma-bridge] llama.cpp system info: {}", s);
                    }
                }
            }
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

            // Unload any previously loaded model first
            if inner.model_loaded {
                self.unload_locked(&mut inner);
            }

            // Build model params
            let mut model_params = unsafe { ffi::llama_model_default_params() };
            model_params.n_gpu_layers = config.gpu_layers;
            model_params.use_mmap = true;
            model_params.use_mlock = false;

            // Convert model_path to CString
            let path_cstr = ffi::to_c_string(&config.model_path).map_err(|e| {
                GemmaError::InvalidConfig {
                    reason: format!("model_path contains NUL byte: {}", e),
                }
            })?;

            // Load the model
            let model = unsafe {
                ffi::llama_model_load_from_file(path_cstr.as_ptr(), model_params)
            };
            if model.is_null() {
                return Err(GemmaError::ModelLoadFailed {
                    path: config.model_path.clone(),
                    reason: "llama_model_load_from_file returned null".to_string(),
                });
            }

            // Get vocab
            let vocab = unsafe { ffi::llama_model_get_vocab(model) };
            if vocab.is_null() {
                unsafe { ffi::llama_model_free(model) };
                return Err(GemmaError::ModelLoadFailed {
                    path: config.model_path.clone(),
                    reason: "llama_model_get_vocab returned null".to_string(),
                });
            }

            // Get special tokens
            let bos_token = unsafe { ffi::llama_vocab_bos(vocab) };
            let eos_token = unsafe { ffi::llama_vocab_eos(vocab) };

            // Build context params
            let mut ctx_params = unsafe { ffi::llama_context_default_params() };
            ctx_params.n_ctx = config.context_length;
            ctx_params.n_batch = config.n_batch;
            ctx_params.n_threads = if config.n_threads == 0 { 4 } else { config.n_threads };
            ctx_params.n_threads_batch = ctx_params.n_threads;
            ctx_params.flash_attn = true;  // Gemma 2 supports flash attention
            ctx_params.offload_kqv = true; // Offload KV cache + queries to GPU

            let ctx = unsafe { ffi::llama_init_from_model(model, ctx_params) };
            if ctx.is_null() {
                unsafe { ffi::llama_model_free(model) };
                return Err(GemmaError::ModelLoadFailed {
                    path: config.model_path.clone(),
                    reason: "llama_init_from_model returned null".to_string(),
                });
            }

            inner.handles.model = model;
            inner.handles.ctx = ctx;
            inner.handles.vocab = vocab;
            inner.handles.bos_token = bos_token;
            inner.handles.eos_token = eos_token;
            inner.handles.config = Some(config.clone());
            inner.config = Some(config);
            inner.model_loaded = true;

            eprintln!("[gemma-bridge] Model loaded: vocab={} tokens, BOS={}, EOS={}",
                unsafe { ffi::llama_vocab_n_tokens(vocab) },
                bos_token, eos_token);
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
            let started = std::time::Instant::now();

            // Build the full prompt with system prompt if present
            let full_prompt = if let Some(sys) = &request.system_prompt {
                // Gemma chat template: <start_of_turn>user\n{system}\n\n{prompt}<end_of_turn>\n<start_of_turn>model\n
                format!(
                    "<start_of_turn>user\n{}\n\n{}<end_of_turn>\n<start_of_turn>model\n",
                    sys, request.prompt
                )
            } else {
                format!("<start_of_turn>user\n{}<end_of_turn>\n<start_of_turn>model\n", request.prompt)
            };

            let inner = self.inner.lock().expect("gemma mutex poisoned");
            if !inner.model_loaded || inner.handles.ctx.is_null() || inner.handles.vocab.is_null() {
                return Err(GemmaError::NotInitialized);
            }

            let vocab = inner.handles.vocab;
            let ctx = inner.handles.ctx;
            let model = inner.handles.model;
            let eos_token = inner.handles.eos_token;

            // 1. Tokenize the prompt
            let prompt_cstr = ffi::to_c_string(&full_prompt).map_err(|e| {
                GemmaError::TokenizationFailed {
                    reason: format!("prompt contains NUL byte: {}", e),
                }
            })?;
            let prompt_bytes = prompt_cstr.to_bytes();
            let prompt_len = prompt_bytes.len() as i32;

            // First call with n_tokens_max=0 to get required size
            let n_required = unsafe {
                ffi::llama_tokenize(vocab, prompt_cstr.as_ptr(), prompt_len, std::ptr::null_mut(), 0, true, true)
            };
            if n_required < 0 {
                return Err(GemmaError::TokenizationFailed {
                    reason: format!("llama_tokenize size query failed: {}", n_required),
                });
            }

            let mut prompt_tokens = vec![0i32; n_required as usize];
            let n_actual = unsafe {
                ffi::llama_tokenize(vocab, prompt_cstr.as_ptr(), prompt_len, prompt_tokens.as_mut_ptr(), n_required, true, true)
            };
            if n_actual < 0 {
                return Err(GemmaError::TokenizationFailed {
                    reason: format!("llama_tokenize failed: {}", n_actual),
                });
            }
            prompt_tokens.truncate(n_actual as usize);

            eprintln!("[gemma-bridge] Prompt tokenized: {} tokens", prompt_tokens.len());

            // 2. Decode the prompt (process it through the model)
            let mut batch = unsafe {
                ffi::llama_batch_get_one(
                    prompt_tokens.as_mut_ptr(),
                    prompt_tokens.len() as i32,
                    0,  // pos_0
                    0,  // seq_id_0
                )
            };

            let decode_result = unsafe { ffi::llama_decode(ctx, batch) };
            // Note: batch is consumed by llama_decode in newer versions; do not free.
            let _ = batch;

            if decode_result != 0 {
                return Err(GemmaError::DecodeFailed {
                    reason: format!("prompt llama_decode returned {}", decode_result),
                });
            }

            // 3. Build the sampler chain: temp -> top_p -> dist (or greedy if temp==0)
            let mut sampler_chain = unsafe {
                ffi::llama_sampler_chain_init(ffi::llama_sampler_chain_default_params())
            };

            if request.temperature == 0.0 {
                let greedy = unsafe { ffi::llama_sampler_init_greedy() };
                unsafe { ffi::llama_sampler_chain_add(&mut sampler_chain, greedy) };
            } else {
                let temp = unsafe { ffi::llama_sampler_init_temp(request.temperature) };
                unsafe { ffi::llama_sampler_chain_add(&mut sampler_chain, temp) };
                let top_p = unsafe { ffi::llama_sampler_init_top_p(request.top_p, 1) };
                unsafe { ffi::llama_sampler_chain_add(&mut sampler_chain, top_p) };
                // Use a per-call seed derived from system time + prompt hash for variety
                let seed = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_nanos() as u32)
                    .unwrap_or(42)
                    .wrapping_add(full_prompt.len() as u32);
                let dist = unsafe { ffi::llama_sampler_init_dist(seed) };
                unsafe { ffi::llama_sampler_chain_add(&mut sampler_chain, dist) };
            }

            // 4. Generate tokens one at a time
            let mut generated_tokens: Vec<i32> = Vec::with_capacity(request.max_tokens as usize);
            let mut generated_text = String::new();
            let mut current_pos = prompt_tokens.len() as i32;

            // Pre-compute stop token IDs (as bytes for fast matching)
            let stop_bytes: Vec<Vec<u8>> = request.stop_sequences.iter().map(|s| s.as_bytes().to_vec()).collect();

            for _ in 0..request.max_tokens {
                // Sample next token from the last logits
                let next_token = unsafe {
                    ffi::llama_sampler_sample(&mut sampler_chain, ctx, -1)
                };

                // Stop on EOS
                if next_token == eos_token || next_token < 0 {
                    break;
                }

                // Convert token to text piece
                let mut buf = vec![0u8; 64];
                let n_bytes = unsafe {
                    ffi::llama_token_to_piece(model, next_token, buf.as_mut_ptr() as *mut std::os::raw::c_char, buf.len() as i32, 0, false)
                };
                if n_bytes < 0 {
                    // Buffer too small — resize and retry
                    buf = vec![0u8; (-n_bytes) as usize];
                    let n_bytes2 = unsafe {
                        ffi::llama_token_to_piece(model, next_token, buf.as_mut_ptr() as *mut std::os::raw::c_char, buf.len() as i32, 0, false)
                    };
                    if n_bytes2 > 0 {
                        buf.truncate(n_bytes2 as usize);
                        if let Ok(s) = std::str::from_utf8(&buf) {
                            generated_text.push_str(s);
                        }
                    }
                } else if n_bytes > 0 {
                    buf.truncate(n_bytes as usize);
                    if let Ok(s) = std::str::from_utf8(&buf) {
                        generated_text.push_str(s);
                    }
                }

                generated_tokens.push(next_token);

                // Check stop sequences
                if !stop_bytes.is_empty() {
                    let text_bytes = generated_text.as_bytes();
                    for sb in &stop_bytes {
                        if text_bytes.len() >= sb.len() && &text_bytes[text_bytes.len() - sb.len()..] == sb.as_slice() {
                            // Strip the stop sequence from the output
                            generated_text.truncate(generated_text.len() - sb.len());
                            // Cleanup and return early
                            unsafe { ffi::llama_sampler_free(&mut sampler_chain) };
                            let latency_ms = started.elapsed().as_millis() as u64;
                            let token_count = generated_tokens.len() as u32;
                            let tokens_per_sec = if latency_ms > 0 {
                                (token_count as f32 / latency_ms as f32) * 1000.0
                            } else { 0.0 };
                            return Ok(GenerateResponse {
                                text: generated_text,
                                token_count,
                                latency_ms,
                                tokens_per_sec,
                            });
                        }
                    }
                }

                // Decode this token to get logits for the next iteration
                current_pos += 1;
                let mut single_token = next_token;
                let mut batch2 = unsafe {
                    ffi::llama_batch_get_one(&mut single_token, 1, current_pos - 1, 0)
                };
                let decode_result = unsafe { ffi::llama_decode(ctx, batch2) };
                let _ = batch2;
                if decode_result != 0 {
                    unsafe { ffi::llama_sampler_free(&mut sampler_chain) };
                    return Err(GemmaError::DecodeFailed {
                        reason: format!("generation llama_decode returned {}", decode_result),
                    });
                }
            }

            // Cleanup sampler
            unsafe { ffi::llama_sampler_free(&mut sampler_chain) };

            let latency_ms = started.elapsed().as_millis() as u64;
            let token_count = generated_tokens.len() as u32;
            let tokens_per_sec = if latency_ms > 0 {
                (token_count as f32 / latency_ms as f32) * 1000.0
            } else { 0.0 };

            eprintln!("[gemma-bridge] Generated {} tokens in {}ms ({:.1} tok/sec)",
                token_count, latency_ms, tokens_per_sec);

            Ok(GenerateResponse {
                text: generated_text,
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
            self.unload_locked(&mut inner);
            Ok(())
        }
        #[cfg(not(feature = "llama_linked"))]
        {
            Err(GemmaError::NotImplemented)
        }
    }

    #[cfg(feature = "llama_linked")]
    fn unload_locked(&self, inner: &mut GemmaBridgeInner) {
        if !inner.handles.ctx.is_null() {
            unsafe { ffi::llama_free(inner.handles.ctx) };
            inner.handles.ctx = std::ptr::null_mut();
        }
        if !inner.handles.model.is_null() {
            unsafe { ffi::llama_model_free(inner.handles.model) };
            inner.handles.model = std::ptr::null_mut();
        }
        inner.handles.vocab = std::ptr::null();
        inner.handles.config = None;
        inner.config = None;
        inner.model_loaded = false;
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
    use jni::objects::{JClass, JString};
    use jni::sys::{jboolean, jint};
    use jni::JNIEnv;

    fn to_jbool(b: bool) -> jboolean {
        if b { jni::sys::JNI_TRUE } else { jni::sys::JNI_FALSE }
    }

    /// JNI: Java_com_ava007_mobile_GemmaBridge_nativeInit
    ///
    /// Initializes the llama.cpp backend with the given GPU backend.
    /// Java signature: `private native boolean nativeInit(String gpuBackend)`
    #[no_mangle]
    pub unsafe extern "system" fn Java_com_ava007_mobile_GemmaBridge_nativeInit(
        mut env: JNIEnv,
        _class: JClass,
        gpu_backend: JString,
    ) -> jboolean {
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
            Ok(()) => to_jbool(true),
            Err(_) => to_jbool(false),
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
    ) -> jboolean {
        let path: String = match env.get_string(&model_path) {
            Ok(s) => s.into(),
            Err(_) => return jni::sys::JNI_FALSE,
        };
        let config = GemmaConfig {
            model_path: path,
            gpu_backend: GpuBackend::Vulkan,
            context_length: context_length as u32,
            gpu_layers: gpu_layers as i32,
            n_batch: 512,
            n_threads: 0,
        };
        match global_bridge().load_model(config) {
            Ok(()) => to_jbool(true),
            Err(_) => to_jbool(false),
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
                let json = serde_json::to_string(&response).unwrap_or_else(|_| "{}".to_string());
                match env.new_string(json) {
                    Ok(s) => s.into_raw(),
                    Err(_) => std::ptr::null_mut(),
                }
            }
            Err(_) => std::ptr::null_mut(),
        }
    }

    /// JNI: Java_com_ava007_mobile_GemmaBridge_nativeIsModelLoaded
    ///
    /// Java signature: `private native boolean nativeIsModelLoaded()`
    #[no_mangle]
    pub unsafe extern "system" fn Java_com_ava007_mobile_GemmaBridge_nativeIsModelLoaded(
        _env: JNIEnv,
        _class: JClass,
    ) -> jboolean {
        to_jbool(global_bridge().is_model_loaded())
    }

    /// JNI: Java_com_ava007_mobile_GemmaBridge_nativeUnload
    ///
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
                n_batch: 512,
                n_threads: 0,
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
        assert!(std::ptr::eq(b1, b2));
    }

    #[test]
    fn default_config_is_vulkan() {
        let config = GemmaConfig::default();
        assert_eq!(config.gpu_backend, GpuBackend::Vulkan);
        assert_eq!(config.context_length, 4096);
        assert_eq!(config.gpu_layers, -1);
        assert_eq!(config.n_batch, 512);
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

    #[test]
    fn gemma_error_includes_all_variants() {
        let variants = vec![
            GemmaError::NotInitialized,
            GemmaError::ModelLoadFailed { path: "p".to_string(), reason: "r".to_string() },
            GemmaError::InferenceFailed { reason: "r".to_string() },
            GemmaError::NotImplemented,
            GemmaError::InvalidConfig { reason: "r".to_string() },
            GemmaError::TokenizationFailed { reason: "r".to_string() },
            GemmaError::DecodeFailed { reason: "r".to_string() },
        ];
        for err in variants {
            // Just verify Display doesn't panic
            let _ = format!("{}", err);
        }
    }
}
