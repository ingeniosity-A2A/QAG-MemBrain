/**
 * BackendExecutor — common interface that all inference backends implement.
 *
 * AMOS v2.6 §5.1 backend priority (per architect's directive):
 *   1. MLC-LLM      (primary — Vulkan/OpenCL on Adreno GPU)
 *   2. WebLLM       (secondary — WebGPU for ArrowJS Sandbox + EPOCH UI)
 *   3. llamdrop     (CPU fallback)
 *   4. Cloud API    (optional — only when requireLocal === false)
 *
 * QNN NPU is deferred until QNN SDK access is approved (Phase 4.3).
 *
 * Each backend implements this interface. Constellation's Router picks
 * the optimal backend per request based on budget / health / policy,
 * then WebLLMEngine dispatches to the chosen backend via this interface.
 *
 * Architecture:
 *   Caller -> WebLLMEngine.generate()
 *           -> Constellation.route()  (picks backend)
 *           -> backendRegistry.get(decision.backend).generate()
 *           -> result back through Meta Harness for audit
 */

import type { Backend, Quantization } from '../BackendRegistry.js';

/**
 * Request to a backend executor.
 */
export interface BackendRequest {
  /** Model ID chosen by Constellation (e.g. 'Llama-3.2-3B-Instruct-q4f16_1-MLC') */
  modelId: string;
  /** Quantization of the model (e.g. 'q4f16') */
  quantization: Quantization;
  /** Prompt text */
  prompt: string;
  /** Optional system prompt */
  systemPrompt?: string;
  /** Max tokens to generate (default: 256) */
  maxTokens?: number;
  /** Temperature 0..1 (default: 0.7) */
  temperature?: number;
  /** Stream tokens as they arrive (default: false) */
  stream?: boolean;
  /** Optional callback for streaming responses */
  onToken?: (token: string) => void;
}

/**
 * Response from a backend executor.
 */
export interface BackendResponse {
  /** Generated text (full text if stream=false; final aggregated text if stream=true) */
  text: string;
  /** Number of tokens generated */
  tokenCount: number;
  /** Wall-clock latency in ms */
  latencyMs: number;
  /** Which backend produced this response */
  backend: Backend;
  /** Model ID that was actually used */
  modelId: string;
  /** Quantization that was actually used */
  quantization: Quantization;
  /** Backend-specific metadata (e.g. tokens/sec, memory used) */
  metadata?: Record<string, unknown>;
}

/**
 * Error thrown by backend executors.
 */
export class BackendError extends Error {
  constructor(
    public readonly backend: Backend,
    public readonly kind: 'not_initialized' | 'model_load_failed' | 'inference_failed' | 'unsupported' | 'timeout',
    message: string,
    public readonly cause?: unknown,
  ) {
    super(`[${backend}] ${kind}: ${message}`);
    this.name = 'BackendError';
  }
}

/**
 * Common interface that all backends implement.
 *
 * Lifecycle:
 *   1. `init()` — called once on app startup (or lazily on first use)
 *   2. `loadModel(modelId, quantization)` — called when Constellation routes to this backend
 *      with a model not currently loaded. May be a no-op if model is already loaded.
 *   3. `generate(request)` — called for each inference request
 *   4. `unload()` — called on shutdown or when RAM pressure requires it
 */
export interface BackendExecutor {
  /** Which backend this executor represents */
  readonly backend: Backend;

  /** Whether the backend is initialized and ready to accept requests */
  isInitialized(): boolean;

  /** Whether a model is currently loaded */
  isModelLoaded(): boolean;

  /** Which model is currently loaded (if any) */
  getLoadedModel(): { modelId: string; quantization: Quantization } | null;

  /**
   * Initialize the backend. Called once on app startup or lazily on first use.
   * Does NOT load any model — that's done by `loadModel()`.
   */
  init(): Promise<void>;

  /**
   * Load a model. May be a no-op if the requested model is already loaded.
   * Throws BackendError on failure.
   */
  loadModel(modelId: string, quantization: Quantization): Promise<void>;

  /**
   * Generate text. Throws BackendError on failure.
   * If stream=true and onToken is provided, calls onToken for each token
   * and returns the full aggregated text in BackendResponse.text.
   */
  generate(request: BackendRequest): Promise<BackendResponse>;

  /** Unload the current model (free RAM). */
  unload(): Promise<void>;

  /** Shutdown the backend entirely. */
  shutdown(): Promise<void>;
}
