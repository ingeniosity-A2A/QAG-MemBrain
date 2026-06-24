/**
 * GemmaBackend — PRIMARY inference backend using Gemma via llama.cpp Vulkan.
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
 * ## Multi-model support
 *
 * AMOS v2.8 supports TWO Gemma models for different roles:
 *
 *   1. PRIMARY (always-on, hot path):
 *      - Gemma 2B Q4_K_M (~1.5 GB)
 *      - Used by REV.IKE reflex layer for sub-100ms responses
 *      - Always loaded in RAM after first use
 *      - Path: /data/data/com.termux/files/usr/share/models/gemma-2-2b-it-Q4_K_M.gguf
 *
 *   2. FABLE (on-demand, multi-step planning):
 *      - Gemma 4 12B agentic fine-tune (yuxinlu1/gemma-4-12B-agentic-fable5-composer2.5-v2-3.5x-tau2-GGUF)
 *      - Used by FABLE pillar when task complexity exceeds REV.IKE's threshold
 *      - Loaded on-demand, unloaded after task completes (frees ~5-7 GB RAM)
 *      - 3.5× improvement over base on tau2-bench telecom (agentic tool use)
 *      - Q4_K_M recommended (~7 GB) or Q3_K_M for tight RAM (~5.5 GB)
 *      - Path: /data/data/com.termux/files/usr/share/models/gemma4-v2-Q4_K_M.gguf
 *
 * Why Gemma 2B is primary (not the 12B):
 *   - Already installed on device (zero download, zero startup cost)
 *   - Sovereign — open-weight, no Google dependency
 *   - Fits in RAM comfortably (~1.5 GB Q4, leaves 10+ GB for AVA007)
 *   - Fast on Adreno Vulkan — 50-150ms first-token
 *   - The 12B model is too heavy for always-on (would starve other processes)
 *
 * Why the 12B fine-tune is FABLE (not primary):
 *   - Agentic + tool-use + coding focus = exactly what FABLE needs
 *   - Trained on Fable 5 traces (rebuilt with Opus 4.8)
 *   - 3.5× improvement on tau2-bench telecom = real terminal/debugging work
 *   - On-demand loading preserves battery + RAM for the common case
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
    gpuLayers?: number;
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

/**
 * Model role — determines which model is loaded.
 *
 * - 'primary': Gemma 2B (always-on, REV.IKE reflex path)
 * - 'fable': Gemma 4 12B agentic fine-tune (on-demand, FABLE planning path)
 */
export type GemmaModelRole = 'primary' | 'fable';

/**
 * Configuration for a single Gemma model.
 */
export interface GemmaModelConfig {
  /** Role: primary (always-on) or fable (on-demand). */
  role: GemmaModelRole;
  /** Path to the GGUF model file on device. */
  modelPath: string;
  /** Human-readable label for logs / audit. */
  label: string;
  /** Context length in tokens. */
  contextLength: number;
  /** GPU layers to offload. -1 = all. */
  gpuLayers: number;
  /** Default max tokens for generate(). */
  defaultMaxTokens: number;
  /** Default temperature for generate(). */
  defaultTemperature: number;
}

/**
 * Default model configurations.
 *
 * Override these via GemmaBackendConfig.models if your device has different paths.
 */
export const DEFAULT_MODELS: Record<GemmaModelRole, GemmaModelConfig> = {
  primary: {
    role: 'primary',
    modelPath: '/data/data/com.termux/files/usr/share/models/gemma-2-2b-it-Q4_K_M.gguf',
    label: 'Gemma 2B Q4 (primary)',
    contextLength: 4096,
    gpuLayers: -1,
    defaultMaxTokens: 256,
    defaultTemperature: 0.7,
  },
  fable: {
    role: 'fable',
    // Downloaded from https://huggingface.co/yuxinlu1/gemma-4-12B-agentic-fable5-composer2.5-v2-3.5x-tau2-GGUF
    // Q4_K_M recommended (~7 GB), Q3_K_M for tight RAM (~5.5 GB)
    modelPath: '/data/data/com.termux/files/usr/share/models/gemma4-v2-Q4_K_M.gguf',
    label: 'Gemma 4 12B v2 agentic (FABLE)',
    contextLength: 8192,  // larger context for multi-step planning
    gpuLayers: -1,
    defaultMaxTokens: 1024,  // longer outputs for plans
    defaultTemperature: 0.3,  // lower temp for deterministic planning
  },
};

export interface GemmaBackendConfig {
  /** GPU backend to use. Default: 'vulkan' (fastest on Adreno, no Knox trip). */
  gpuBackend?: 'vulkan' | 'opencl' | 'cpu';
  /** Override default model configs. Optional. */
  models?: Partial<Record<GemmaModelRole, Partial<GemmaModelConfig>>>;
}

export class GemmaBackend implements BackendExecutor {
  readonly backend: Backend = 'webgpu'; // Maps to 'webgpu' Backend type (Adreno GPU)

  private initialized = false;
  private config: GemmaBackendConfig;
  private bridge: GemmaBridgePlugin | null = null;
  private loadedModel: { modelId: string; quantization: Quantization } | null = null;
  private loadedRole: GemmaModelRole | null = null;
  private models: Record<GemmaModelRole, GemmaModelConfig>;

  constructor(config: GemmaBackendConfig = {}) {
    this.config = config;
    // Merge defaults with any overrides
    this.models = {
      primary: { ...DEFAULT_MODELS.primary, ...config.models?.primary },
      fable: { ...DEFAULT_MODELS.fable, ...config.models?.fable },
    };
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  isModelLoaded(): boolean {
    return this.loadedModel !== null && this.loadedRole !== null;
  }

  getLoadedModel(): { modelId: string; quantization: Quantization } | null {
    return this.loadedModel;
  }

  /** Which role is currently loaded (primary or fable). */
  getLoadedRole(): GemmaModelRole | null {
    return this.loadedRole;
  }

  /** Get the model config for a role. */
  getModelConfig(role: GemmaModelRole): GemmaModelConfig {
    return this.models[role];
  }

  /**
   * Initialize the backend. Does NOT load any model yet — that happens in
   * `loadModel()`. Just acquires the Capacitor plugin reference.
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
   * Load a Gemma model.
   *
   * The `modelId` from Constellation's routing decision is interpreted as:
   *   - 'gemma-2-2b' or 'gemma-2b' or 'primary' → primary model (Gemma 2B)
   *   - 'gemma-4-12b' or 'gemma-4' or 'fable' → FABLE model (Gemma 4 12B agentic)
   *   - Any other string → treated as a custom model path
   *
   * If a different model is already loaded, it's unloaded first (frees RAM).
   */
  async loadModel(modelId: string, quantization: Quantization): Promise<void> {
    if (!this.initialized || !this.bridge) {
      throw new BackendError(this.backend, 'not_initialized', 'Call init() first');
    }

    // Determine which role to load based on modelId
    const role = this.roleFromModelId(modelId);
    const modelConfig = this.models[role];

    // No-op if already loaded with the same model + role
    if (this.loadedRole === role &&
        this.loadedModel?.modelId === modelId &&
        this.loadedModel?.quantization === quantization) {
      const status = await this.bridge.isModelLoaded();
      if (status.loaded) return;
    }

    // Unload any previously loaded model (frees RAM — important when switching
    // from primary to fable, since fable is much larger)
    if (this.loadedModel) {
      try {
        await this.bridge.unload();
      } catch {
        // Ignore unload errors
      }
      this.loadedModel = null;
      this.loadedRole = null;
    }

    try {
      const result = await this.bridge.init({
        modelPath: modelConfig.modelPath,
        gpuBackend: this.config.gpuBackend ?? 'vulkan',
        contextLength: modelConfig.contextLength,
        gpuLayers: modelConfig.gpuLayers,
      });
      if (!result.success) {
        throw new Error(result.error ?? 'Unknown init failure');
      }
      this.loadedModel = { modelId, quantization };
      this.loadedRole = role;
    } catch (e) {
      throw new BackendError(
        this.backend,
        'model_load_failed',
        `Failed to load ${modelConfig.label} from '${modelConfig.modelPath}': ` +
          `${e instanceof Error ? e.message : String(e)}. ` +
          `Ensure: (1) model file exists at the path, (2) libllama.so + libggml-vulkan.so ` +
          `are in jniLibs/arm64-v8a/, (3) GemmaBridge.kt is registered in MainActivity.`,
        e,
      );
    }
  }

  /**
   * Generate text using the currently loaded Gemma model.
   *
   * For the FABLE model (Gemma 4 12B), the system prompt should describe the
   * planning task. The model was fine-tuned for agentic + tool-use + coding,
   * so it handles multi-step planning well.
   *
   * For the PRIMARY model (Gemma 2B), keep prompts short — this is the
   * reflex path, not deep reasoning.
   */
  async generate(request: BackendRequest): Promise<BackendResponse> {
    if (!this.initialized || !this.bridge) {
      throw new BackendError(this.backend, 'not_initialized', 'Call init() first');
    }
    if (!this.loadedModel || !this.loadedRole) {
      throw new BackendError(this.backend, 'not_initialized', 'No model loaded. Call loadModel() first.');
    }

    const startedAt = Date.now();
    const modelConfig = this.models[this.loadedRole];

    try {
      const result = await this.bridge.generate({
        prompt: request.prompt,
        systemPrompt: request.systemPrompt,
        maxTokens: request.maxTokens ?? modelConfig.defaultMaxTokens,
        temperature: request.temperature ?? modelConfig.defaultTemperature,
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
          gpuBackend: this.config.gpuBackend ?? 'vulkan',
          modelRole: this.loadedRole,
          modelLabel: modelConfig.label,
        },
      };
    } catch (e) {
      throw new BackendError(
        this.backend,
        'inference_failed',
        `${modelConfig.label} inference failed: ${e instanceof Error ? e.message : String(e)}`,
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
    this.loadedRole = null;
  }

  async shutdown(): Promise<void> {
    await this.unload();
    this.bridge = null;
    this.initialized = false;
  }

  /**
   * Map a Constellation routing modelId to a GemmaModelRole.
   *
   * Recognized modelIds:
   *   - 'gemma-2-2b', 'gemma-2b', 'gemma2b', 'primary' → 'primary'
   *   - 'gemma-4-12b', 'gemma-4', 'gemma4', 'fable' → 'fable'
   *   - Anything else → defaults to 'primary' (safe fallback)
   */
  private roleFromModelId(modelId: string): GemmaModelRole {
    const lower = modelId.toLowerCase();
    if (lower.includes('fable') || lower.includes('gemma-4') || lower.includes('gemma4') || lower.includes('12b')) {
      return 'fable';
    }
    return 'primary';
  }
}
