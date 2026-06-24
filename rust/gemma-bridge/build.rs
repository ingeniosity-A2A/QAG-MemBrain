// build.rs for gemma-bridge — links to llama.cpp when llama_linked feature is on.
//
// When `llama_linked` is enabled:
//   1. Reads LLAMA_LIB_DIR env var (or uses default path)
//   2. Links to libllama + libggml-vulkan (or libggml-base + libggml-cpu etc.)
//   3. Adds the lib dir to the linker search path
//
// Without `llama_linked`, this is a no-op.

fn main() {
    // Only run when the feature is enabled
    let llama_linked = std::env::var("CARGO_FEATURE_LLAMA_LINKED").is_ok();

    if !llama_linked {
        return;
    }

    // Find llama.cpp libraries
    let lib_dir = std::env::var("LLAMA_LIB_DIR")
        .unwrap_or_else(|_| "/usr/local/lib".to_string());

    println!("cargo:rustc-link-search=native={}", lib_dir);

    // Link order matters: ggml backends first, then core, then llama
    // Vulkan backend
    println!("cargo:rustc-link-lib=dylib=ggml-vulkan");
    // CPU base backend (required even when using Vulkan)
    println!("cargo:rustc-link-lib=dylib=ggml-base");
    println!("cargo:rustc-link-lib=dylib=ggml-cpu");
    // Core llama.cpp library
    println!("cargo:rustc-link-lib=dylib=llama");
    // Standard libs that llama.cpp depends on
    println!("cargo:rustc-link-lib=dylib=log");
    println!("cargo:rustc-link-lib=dylib=vulkan");

    // Rerun if these env vars change
    println!("cargo:rerun-if-env-changed=LLAMA_LIB_DIR");
}
