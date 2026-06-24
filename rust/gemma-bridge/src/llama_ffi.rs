//! llama_ffi — Raw FFI bindings to llama.cpp C API.
//!
//! Generated manually from llama.cpp's include/llama.h.
//! Linked when `llama_linked` feature is enabled.
//!
//! Reference: https://github.com/ggerganov/llama.cpp/blob/master/include/llama.h
//!
//! These bindings target llama.cpp commit b4400 (Nov 2025) or later.
//! API drift is a real risk — re-verify against current llama.h when
//! rebuilding with newer commits.

#![cfg(feature = "llama_linked")]
#![allow(non_camel_case_types, non_snake_case, dead_code)]

use std::os::raw::{c_char, c_int, c_void};

// ============================================================================
// Opaque types — pointers to internal llama.cpp structs
// ============================================================================

#[repr(C)]
pub struct llama_model {
    _private: [u8; 0],
}

#[repr(C)]
pub struct llama_context {
    _private: [u8; 0],
}

#[repr(C)]
pub struct llama_vocab {
    _private: [u8; 0],
}

#[repr(C)]
pub struct llama_sampler {
    _private: [u8; 0],
}

// ============================================================================
// Constants
// ============================================================================

pub const LLAMA_DEFAULT_VOCAB: c_int = 0;

/// Special token type for llama_token_get_type
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum llama_token_type {
    LLAMA_TOKEN_TYPE_UNDEFINED = 0,
    LLAMA_TOKEN_TYPE_NORMAL = 1,
    LLAMA_TOKEN_TYPE_UNKNOWN = 2,
    LLAMA_TOKEN_TYPE_CONTROL = 3,
    LLAMA_TOKEN_TYPE_USER_DEFINED = 4,
    LLAMA_TOKEN_TYPE_UNUSED = 5,
    LLAMA_TOKEN_TYPE_BYTE = 6,
}

/// Special token flags
pub const LLAMA_TOKEN_ATTR_UNDEFINED: u32 = 0;
pub const LLAMA_TOKEN_ATTR_UNKNOWN: u32 = 1 << 0;
pub const LLAMA_TOKEN_ATTR_UNUSED: u32 = 1 << 1;
pub const LLAMA_TOKEN_ATTR_NORMAL: u32 = 1 << 2;
pub const LLAMA_TOKEN_ATTR_CONTROL: u32 = 1 << 3;
pub const LLAMA_TOKEN_ATTR_USER_DEFINED: u32 = 1 << 4;
pub const LLAMA_TOKEN_ATTR_BYTE: u32 = 1 << 5;
pub const LLAMA_TOKEN_ATTR_NORMAL_STRIPPED: u32 = 1 << 6; // token is normal but stripped of leading space
pub const LLAMA_TOKEN_ATTR_LSTRIP: u32 = 1 << 7;
pub const LLAMA_TOKEN_ATTR_RSTRIP: u32 = 1 << 8;
pub const LLAMA_TOKEN_ATTR_SINGLE_WORD: u32 = 1 << 9;

// ============================================================================
// Backend init / shutdown
// ============================================================================

#[repr(C)]
pub struct llama_backend_init_params {
    pub numa: bool,
}

extern "C" {
    pub fn llama_backend_init(params: llama_backend_init_params);
    pub fn llama_backend_free();
}

// ============================================================================
// Model loading
// ============================================================================

#[repr(C)]
pub struct llama_model_params {
    pub n_gpu_layers: i32,
    pub split_mode: i32,
    pub main_gpu: i32,
    pub tensor_split: *const f32,
    pub progress_callback: Option<extern "C" fn(progress: f32, ctx: *mut c_void) -> bool>,
    pub progress_callback_user_data: *mut c_void,
    pub kv_overrides: *const c_void,
    pub vocab_only: bool,
    pub use_mmap: bool,
    pub use_mlock: bool,
}

extern "C" {
    pub fn llama_model_load_from_file(
        path_model: *const c_char,
        params: llama_model_params,
    ) -> *mut llama_model;

    pub fn llama_model_free(model: *mut llama_model);

    pub fn llama_model_default_params() -> llama_model_params;

    pub fn llama_model_get_vocab(model: *const llama_model) -> *const llama_vocab;

    pub fn llama_vocab_n_tokens(vocab: *const llama_vocab) -> i32;
}

// ============================================================================
// Context creation
// ============================================================================

#[repr(C)]
pub struct llama_context_params {
    pub n_ctx: u32,
    pub n_batch: u32,
    pub n_ubatch: u32,
    pub n_seq_max: u32,
    pub n_threads: u32,
    pub n_threads_batch: u32,
    pub ropest_scaling_type: i32,
    pub pooling_type: i32,
    pub attention_type: i32,
    pub ropest_freq_base: f32,
    pub ropest_freq_scale: f32,
    pub yarn_ext_factor: f32,
    pub yarn_attn_factor: f32,
    pub yarn_beta_fast: f32,
    pub yarn_beta_slow: f32,
    pub yarn_orig_ctx: u32,
    pub defrag_thold: f32,
    pub cb_eval: *const c_void,
    pub cb_eval_user_data: *mut c_void,
    pub type_k: i32,
    pub type_v: i32,
    pub logits_all: bool,
    pub embeddings: bool,
    pub offload_kqv: bool,
    pub flash_attn: bool,
    pub no_perf: bool,
}

extern "C" {
    pub fn llama_init_from_model(
        model: *mut llama_model,
        params: llama_context_params,
    ) -> *mut llama_context;

    pub fn llama_free(ctx: *mut llama_context);

    pub fn llama_context_default_params() -> llama_context_params;

    pub fn llama_n_ctx(ctx: *const llama_context) -> u32;

    pub fn llama_n_batch(ctx: *const llama_context) -> u32;

    pub fn llama_get_logits(ctx: *mut llama_context) -> *mut f32;

    pub fn llama_get_logits_ith(ctx: *mut llama_context, i: i32) -> *mut f32;

    pub fn llama_get_model(ctx: *const llama_context) -> *mut llama_model;
}

// ============================================================================
// Vocab / tokens
// ============================================================================

extern "C" {
    /// Returns the BOS (begin-of-sequence) token.
    pub fn llama_vocab_bos(vocab: *const llama_vocab) -> i32;

    /// Returns the EOS (end-of-sequence) token.
    pub fn llama_vocab_eos(vocab: *const llama_vocab) -> i32;

    /// Returns the NL (newline) token.
    pub fn llama_vocab_nl(vocab: *const llama_vocab) -> i32;

    /// Returns whether the vocab adds a BOS token by default.
    pub fn llama_vocab_get_add_bos(vocab: *const llama_vocab) -> bool;

    /// Returns whether the vocab adds an EOS token by default.
    pub fn llama_vocab_get_add_eos(vocab: *const llama_vocab) -> bool;

    /// Tokenize a string. Returns number of tokens written (or negative on error / required buffer size).
    pub fn llama_tokenize(
        vocab: *const llama_vocab,
        text: *const c_char,
        text_len: i32,
        tokens: *mut i32,
        n_tokens_max: i32,
        add_special: bool,
        parse_special: bool,
    ) -> i32;

    /// Convert a token to its byte representation (UTF-8). Returns bytes written (or negative on error).
    pub fn llama_token_to_piece(
        model: *const llama_model,
        token: i32,
        buf: *mut c_char,
        length: i32,
        lstrip: i32,
        special: bool,
    ) -> i32;
}

// ============================================================================
// Batching
// ============================================================================

/// A single token position in a batch.
/// Mirrors llama.cpp's `llama_pos` (i32) and `llama_seq_id` (i32).
pub type llama_pos = i32;
pub type llama_seq_id = i32;

#[repr(C)]
pub struct llama_batch {
    pub n_tokens: i32,
    pub token: *mut i32,
    pub embd: *mut f32,
    pub pos: *mut llama_pos,
    pub n_seq_id: *mut i32,
    pub seq_id: *mut *mut llama_seq_id,
    pub logits: *mut i8,
}

extern "C" {
    /// Get a one-token batch (for single-token decode in generation loop).
    pub fn llama_batch_get_one(
        tokens: *mut i32,
        n_tokens: i32,
        pos_0: llama_pos,
        seq_id_0: llama_seq_id,
    ) -> llama_batch;

    /// Decode a batch. Returns 0 on success, <0 on error.
    pub fn llama_decode(ctx: *mut llama_context, batch: llama_batch) -> i32;

    /// Free batch resources (allocated by llama.cpp internals).
    pub fn llama_batch_free(batch: llama_batch);
}

// ============================================================================
// Samplers (new API — replaces deprecated llama_sample_* functions)
// ============================================================================

#[repr(C)]
pub struct llama_sampler_chain_params {
    pub no_perf: bool,
}

extern "C" {
    pub fn llama_sampler_chain_default_params() -> llama_sampler_chain_params;
    pub fn llama_sampler_chain_init(params: llama_sampler_chain_params) -> llama_sampler;
    pub fn llama_sampler_chain_add(chain: *mut llama_sampler, sampler: llama_sampler);
    pub fn llama_sampler_free(sampler: *mut llama_sampler);

    /// Sample a token from the logits at position `idx`.
    pub fn llama_sampler_sample(
        sampler: *mut llama_sampler,
        ctx: *mut llama_context,
        idx: i32,
    ) -> i32;

    /// Greedy sampler (always picks max logit) — fastest, most deterministic.
    pub fn llama_sampler_init_greedy() -> llama_sampler;

    /// Distribution sampler (uses temperature) — for varied output.
    pub fn llama_sampler_init_dist(seed: u32) -> llama_sampler;

    /// Temperature scaling sampler.
    pub fn llama_sampler_init_temp(temp: f32) -> llama_sampler;

    /// Top-P (nucleus) sampler.
    pub fn llama_sampler_init_top_p(p: f32, min_keep: u32) -> llama_sampler;

    /// Top-K sampler.
    pub fn llama_sampler_init_top_k(k: i32) -> llama_sampler;
}

// ============================================================================
// Performance / utility
// ============================================================================

extern "C" {
    pub fn llama_print_system_info() -> *const c_char;
    pub fn llama_print_timings(ctx: *mut llama_context);
    pub fn llama_reset_timings(ctx: *mut llama_context);

    /// Sets a log callback.
    pub fn llama_log_set(
        log_callback: Option<extern "C" fn(level: i32, text: *const c_char, user_data: *mut c_void)>,
        user_data: *mut c_void,
    );
}

// ============================================================================
// Helper: safe wrappers
// ============================================================================

use std::ffi::{CStr, CString};

/// Convert a Rust &str to a NUL-terminated CString suitable for FFI.
pub fn to_c_string(s: &str) -> Result<CString, std::ffi::NulError> {
    CString::new(s)
}

/// Convert a C string pointer back to a Rust String. Returns None on null or invalid UTF-8.
pub fn from_c_string(ptr: *const c_char) -> Option<String> {
    if ptr.is_null() {
        return None;
    }
    unsafe { CStr::from_ptr(ptr).to_str().ok().map(|s| s.to_owned()) }
}
