// GemmaBridge — Capacitor plugin for Gemma 2B inference via llama.cpp Vulkan.
//
// AMOS v2.8 §5.1 — Primary inference path.
//
// Architecture:
//   TypeScript GemmaBackend.ts → Capacitor plugin (this file)
//     → JNI → Rust libgemma_bridge.so → llama.cpp libllama.so + libggml-vulkan.so
//     → Adreno GPU (Vulkan compute shaders)
//
// Build prerequisites:
//   1. Build llama.cpp with -DGGML_VULKAN=ON for arm64-v8a
//   2. Place libllama.so + libggml-vulkan.so in android/app/src/main/jniLibs/arm64-v8a/
//   3. Build rust/gemma-bridge with: cargo ndk --target aarch64-linux-android --features jni
//   4. Place libgemma_bridge.so in android/app/src/main/jniLibs/arm64-v8a/
//
// Model:
//   Gemma 2B GGUF at /data/data/com.termux/files/usr/share/models/gemma-2-2b-it-Q4_K_M.gguf
//   (already installed via Ubuntu proot per the architect)

package com.ava007.mobile

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONArray

@CapacitorPlugin(name = "GemmaBridge")
class GemmaBridge : Plugin() {

    companion object {
        init {
            // Load native libraries in dependency order.
            // ggml-vulkan first (provides GPU backend),
            // then llama (depends on ggml),
            // then gemma_bridge (depends on llama).
            try {
                System.loadLibrary("ggml-vulkan")
                System.loadLibrary("llama")
                System.loadLibrary("gemma_bridge")
            } catch (e: UnsatisfiedLinkError) {
                // Libraries not available — running in test/dev environment.
                // The native methods will return false/null when called.
                android.util.Log.w("GemmaBridge", "Native libraries not loaded: ${e.message}")
            }
        }
    }

    // Native method declarations — implemented in rust/gemma-bridge/src/lib.rs
    private external fun nativeInit(gpuBackend: String): Boolean
    private external fun nativeLoadModel(modelPath: String, contextLength: Int, gpuLayers: Int): Boolean
    private external fun nativeGenerate(
        prompt: String,
        systemPrompt: String?,
        maxTokens: Int,
        temperature: Float,
        topP: Float
    ): String?
    private external fun nativeIsModelLoaded(): Boolean
    private external fun nativeUnload()

    @PluginMethod
    fun init(call: PluginCall) {
        val modelPath = call.getString("modelPath") ?: ""
        val gpuBackend = call.getString("gpuBackend", "vulkan")
        val contextLength = call.getInt("contextLength", 4096)
        val gpuLayers = call.getInt("gpuLayers", -1)

        if (modelPath.isEmpty()) {
            call.reject("modelPath is required")
            return
        }

        try {
            // Initialize the backend with GPU selection
            val initOk = nativeInit(gpuBackend)
            if (!initOk) {
                call.reject("Failed to initialize llama.cpp backend with $gpuBackend. " +
                    "Ensure libllama.so + libggml-vulkan.so are in jniLibs/arm64-v8a/.")
                return
            }

            // Load the model
            val loadOk = nativeLoadModel(modelPath, contextLength, gpuLayers)
            if (!loadOk) {
                call.reject("Failed to load model from $modelPath. " +
                    "Ensure the file exists and is a valid GGUF.")
                return
            }

            val result = JSObject()
            result.put("success", true)
            call.resolve(result)
        } catch (e: UnsatisfiedLinkError) {
            call.reject("Native library not available: ${e.message}. " +
                "Build rust/gemma-bridge with --features jni and place libgemma_bridge.so in jniLibs/.")
        } catch (e: Exception) {
            call.reject("Init failed: ${e.message}")
        }
    }

    @PluginMethod
    fun generate(call: PluginCall) {
        val prompt = call.getString("prompt") ?: ""
        val systemPrompt = call.getString("systemPrompt")
        val maxTokens = call.getInt("maxTokens", 256)
        val temperature = call.getFloat("temperature", 0.7f)
        val topP = call.getFloat("topP", 0.9f)

        if (prompt.isEmpty()) {
            call.reject("prompt is required")
            return
        }

        try {
            val jsonResult = nativeGenerate(prompt, systemPrompt, maxTokens, temperature, topP)
            if (jsonResult == null) {
                call.reject("Generation failed — no model loaded or inference error")
                return
            }

            // Parse the JSON response from Rust
            val response = JSObject(jsonResult)
            call.resolve(response)
        } catch (e: UnsatisfiedLinkError) {
            call.reject("Native library not available: ${e.message}")
        } catch (e: Exception) {
            call.reject("Generate failed: ${e.message}")
        }
    }

    @PluginMethod
    fun isModelLoaded(call: PluginCall) {
        try {
            val loaded = nativeIsModelLoaded()
            val result = JSObject()
            result.put("loaded", loaded)
            call.resolve(result)
        } catch (e: UnsatisfiedLinkError) {
            val result = JSObject()
            result.put("loaded", false)
            call.resolve(result)
        }
    }

    @PluginMethod
    fun unload(call: PluginCall) {
        try {
            nativeUnload()
        } catch (e: UnsatisfiedLinkError) {
            // Ignore — nothing to unload
        }
        call.resolve()
    }
}
