/**
 * GemmaBackend — PRIMARY inference backend using Gemma 2B via llama.cpp Vulkan.
 *
 * AMOS v2.8 §5.1 — Primary backend.
 *
 * Per the architect's directive:
 *   "Gemma 2B was installed through Ubuntu. I wanted to run native options
 *    so we can unlock network without tripping Knox."
 *
 * Architecture:
 *   TS (this file) → Capacitor GemmaBridge plugin → Kotlin GemmaBridge.kt
 *     → JNI → Rust libgemma_bridge.so → llama.cpp libllama.so + libggml-vulkan.so
 *     → Adreno GPU (Vulkan compute shaders)
 *
 * Why Gemma 2B is primary (per v2.8 §5.2):
 *   - Already installed on device (zero download, zero startup cost)
 *   - Sovereign — open-weight, no Google dependency
 *   - Real — gemma-2-2b-it-Q4_K_M.gguf is on HuggingFace
 *   - Fits in RAM — ~1.5 GB Q4, leaves 10+ GB for AVA007
 *   - Fast on Adreno Vulkan — 50-150ms first-token
 *   - No Knox trip — llama.cpp uses standard Vulkan compute shaders
 *
 * Why NOT @mlc-ai/web-llm (which MlcLlmBackend uses):
 *   - @mlc-ai/web-llm runs in browser WebGPU context (sandboxed)
 *   - llama.cpp runs as native .so (full GPU access, no browser overhead)
 *   - For AVA007's primary path, native is faster + more sovereign
 *   - WebLLM stays as secondary for EPOCH/sandbox isolation
 */

import type { Backend, Quantization } from '../BackendRegistry.js';
import {
  type BackendExecutor,
  type BackendRequest,
  type BackendResponse,
  BackendError,
} from './BackendExecutor.js';

/**
 * Minimal interface for the Capacitor GemmaBridge plugin.
 *
 * The real plugin is registered in mobile/capacitor/android/app/src/main/java/
 * com/ava007/mobile/GemmaBridge.kt and exposed via `registerPlugin('GemmaBridge')`.
 */
interface GemmaBridgePlugin {
  /** Initialize the llama.cpp context with the given model path + GPU backend */
  init(options: {
    modelPath: string;
    gpuBackend: 'vulkan' | 'opencl' | 'cpu';
    contextLength?: number;
    gpuLayers?: number; // -1 = all layers on GPU
  }): Promise<{ success: boolean; error?: string }>;

  /** Generate text */
  generate(options: {
    prompt: string;
    systemPrompt?: string;
    maxTokens?: number;
    temperature?: number;
    topP?: number;
    stopSequences?: string[];
  }): Promise<{
    text: string;
    tokenCount: number;
    latencyMs: number;
    tokensPerSec: number;
  }>;

  /** Check if model is loaded */
  isModelLoaded(): Promise<{ loaded: boolean; modelPath?: string }>;

  /** Unload model */
  unload(): Promise<void>;
}

/**
 * Lazy-load the Capacitor plugin. Returns null if not on native platform
 * (e.g. running in browser dev environment).
 */
async function getGemmaBridge(): Promise<GemmaBridgePlugin | null> {
  try {
    // @ts-ignore — Capacitor registerPlugin is available at runtime on native;
    // @capacitor/core may not be installed in dev environment
    const cap = await import('@capacitor/core');
    const registerPlugin = cap.registerPlugin;
    if (typeof registerPlugin !== 'function') return null;
    // @ts-ignore — generic type arg on untyped function call
    return registerPlugin('GemmaBridge') as GemmaBridgePlugin;
  } catch {
    return null;
  }
}

export interface GemmaBackendConfig {
  /** Path to the Gemma 2B GGUF model file on device.
   *
   * Per the architect: Gemma 2B is installed via Ubuntu proot.
   * Typical path: /data/data/com.termux/files/usr/share/models/gemma-2-2b-it-Q4_K_M.gguf
   * Or via the app's files dir: /data/data/com.ava007.mobile/files/models/gemma-2-2b-it-Q4_K_M.gguf
   */
  modelPath: string;

  /** GPU backend to use. Default: 'vulkan' (fastest on Adreno, no Knox trip). */
  gpuBackend?: 'vulkan' | 'opencl' | 'cpu';

  /** Context length in tokens. Default: 4096. */
  contextLength?: number;

  /** Number of layers to offload to GPU. -1 = all. Default: -1. */
  gpuLayers?: number;
}

export class GemmaBackend implements BackendExecutor {
  readonly backend: Backend = 'webgpu'; // Maps to 'webgpu' Backend type (Adreno GPU)

  private initialized = false;
  private config: GemmaBackendConfig | null = null;
  private bridge: GemmaBridgePlugin | null = null;
  private loadedModel: { modelId: string; quantization: Quantization } | null = null;

  isInitialized(): boolean {
    return this.initialized;
  }

  isModelLoaded(): boolean {
    return this.loadedModel !== null;
  }

  getLoadedModel(): { modelId: string; quantization: Quantization } | null {
    return this.loadedModel;
  }

  /**
   * Initialize the backend. Does NOT load the model yet — that happens in
   * `loadModel()`. Just acquires the Capacitor plugin reference.
   *
   * The config (including modelPath) is passed to `loadModel()`, not `init()`.
   * This matches the BackendExecutor interface contract.
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    this.bridge = await getGemmaBridge();
    if (!this.bridge) {
      throw new BackendError(
        this.backend,
        'not_initialized',
        'GemmaBridge Capacitor plugin not available. ' +
          'Running in browser? Use WebLlmBackend instead. ' +
          'On native, ensure GemmaBridge.kt is registered in MainActivity.',
      );
    }
    this.initialized = true;
  }

  /**
   * Load the Gemma 2B model via llama.cpp.
   *
   * The caller must provide the model path. Per the architect, Gemma 2B is
   * already installed via Ubuntu proot. The path is typically:
   *   /data/data/com.termux/files/usr/share/models/gemma-2-2b-it-Q4_K_M.gguf
   *
   * This method calls the native GemmaBridge.kt plugin, which in turn calls
   * rust/gemma-bridge/ → libllama.so + libggml-vulkan.so.
   */
  async loadModel(modelId: string, quantization: Quantization): Promise<void> {
    if (!this.initialized || !this.bridge) {
      throw new BackendError(this.backend, 'not_initialized', 'Call init() first');
    }

    // The "modelId" from Constellation's routing decision is the HuggingFace-style
    // name (e.g. "gemma-2-2b-it"). The actual GGUF file path comes from config.
    // In production, we'd have a model registry mapping modelId -> file path.
    // For now, use config.modelPath directly.

    // Build the model path from modelId if config.modelPath isn't set
    const defaultPath = `/data/data/com.termux/files/usr/share/models/${modelId}-Q4_K_M.gguf`;

    if (!this.config) {
      // Use default config
      this.config = {
        modelPath: defaultPath,
        gpuBackend: 'vulkan',
        contextLength: 4096,
        gpuLayers: -1,
      };
    }

    // No-op if already loaded with the same model
    if (this.loadedModel?.modelId === modelId && this.loadedModel?.quantization === quantization) {
      // Verify the native side agrees
      const status = await this.bridge.isModelLoaded();
      if (status.loaded) return;
    }

    try {
      const result = await this.bridge.init({
        modelPath: this.config.modelPath,
        gpuBackend: this.config.gpuBackend ?? 'vulkan',
        contextLength: this.config.contextLength ?? 4096,
        gpuLayers: this.config.gpuLayers ?? -1,
      });
      if (!result.success) {
        throw new Error(result.error ?? 'Unknown init failure');
      }
      this.loadedModel = { modelId, quantization };
    } catch (e) {
      throw new BackendError(
        this.backend,
        'model_load_failed',
        `Failed to load Gemma 2B from '${this.config.modelPath}': ` +
          `${e instanceof Error ? e.message : String(e)}. ` +
          `Ensure: (1) model file exists at the path, (2) libllama.so + libggml-vulkan.so ` +
          `are in jniLibs/arm64-v8a/, (3) GemmaBridge.kt is registered in MainActivity.`,
        e,
      );
    }
  }

  /**
   * Generate text using Gemma 2B via llama.cpp Vulkan.
   *
   * Flow:
   *   TS (this method) → Capacitor GemmaBridge plugin → Kotlin GemmaBridge.kt
   *     → JNI → Rust libgemma_bridge.so → llama.cpp → Adreno GPU (Vulkan)
   *     → generated tokens → back up the chain → BackendResponse
   */
  async generate(request: BackendRequest): Promise<BackendResponse> {
    if (!this.initialized || !this.bridge) {
      throw new BackendError(this.backend, 'not_initialized', 'Call init() first');
    }
    if (!this.loadedModel) {
      throw new BackendError(this.backend, 'not_initialized', 'No model loaded. Call loadModel() first.');
    }

    const startedAt = Date.now();

    try {
      const result = await this.bridge.generate({
        prompt: request.prompt,
        systemPrompt: request.systemPrompt,
        maxTokens: request.maxTokens ?? 256,
        temperature: request.temperature ?? 0.7,
        topP: 0.9,
      });

      return {
        text: result.text,
        tokenCount: result.tokenCount,
        latencyMs: Date.now() - startedAt,
        backend: this.backend,
        modelId: this.loadedModel.modelId,
        quantization: this.loadedModel.quantization,
        metadata: {
          tokensPerSec: result.tokensPerSec,
          gpuBackend: this.config?.gpuBackend ?? 'vulkan',
        },
      };
    } catch (e) {
      throw new BackendError(
        this.backend,
        'inference_failed',
        `Gemma 2B inference failed: ${e instanceof Error ? e.message : String(e)}`,
        e,
      );
    }
  }

  async unload(): Promise<void> {
    if (this.bridge && this.loadedModel) {
      try {
        await this.bridge.unload();
      } catch {
        // Ignore
      }
    }
    this.loadedModel = null;
  }

  async shutdown(): Promise<void> {
    await this.unload();
    this.bridge = null;
    this.initialized = false;
    this.config = null;
  }
}
