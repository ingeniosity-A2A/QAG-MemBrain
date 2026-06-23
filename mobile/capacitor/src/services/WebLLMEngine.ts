/**
 * WebLLMEngine — AMOS v2.6 inference engine wired through Constellation.
 *
 * AMOS authority flow:
 *   Caller -> Meta Harness (intercept) -> WebLLMEngine.generate()
 *     -> Constellation.route()  (picks optimal backend + model)
 *     -> BackendExecutorRegistry.get(decision.backend).generate()
 *     -> Result back through Meta Harness -> Audit log -> TASHI receipt
 *
 * Nothing bypasses Constellation. Even when the caller "knows" which model
 * they want, Constellation has the final say based on budget / health /
 * policy constraints.
 *
 * AMOS v2.6 §5.1 backend priority (per architect's directive):
 *   1. MLC-LLM      (primary — Vulkan/OpenCL on Adreno)
 *   2. WebLLM       (secondary — WebGPU for ArrowJS Sandbox + EPOCH)
 *   3. llamdrop     (CPU fallback — stub)
 *   4. Cloud API    (optional — only when requireLocal === false)
 *
 * QNN NPU is deferred (Phase 4.3, requires QNN SDK access).
 */

import { constellation } from '../../../../src/constellation/index.js';
import type { RoutingRequest, RoutingDecision } from '../../../../src/constellation/Router.js';
import type { Backend, Quantization } from '../../../../src/constellation/BackendRegistry.js';
import {
  getBackendRegistry,
  type BackendExecutor,
  type BackendRequest,
  type BackendResponse,
  BackendError,
} from '../../../../src/constellation/backends/index.js';

export interface WebLLMConfig {
  /** Caller's preferred model ID — Constellation may override based on policy. */
  modelId: string;
  contextLength: number;
  quantization: 'q4f16_1' | 'q4f32_1' | 'q0f32';
  /** Optional per-call budget constraints. */
  budget?: {
    maxLatencyMs?: number;
    maxBatteryPct?: number;
    maxCostUsd?: number;
  };
  /** Force local-only execution (privacy / offline mode). */
  requireLocal?: boolean;
  /** Hint about the kind of task — helps Constellation pick the right model. */
  task?: 'reflex' | 'planning' | 'code' | 'math' | 'reasoning' | 'general';
}

export interface GenerateResult {
  /** The actual text output from the model. */
  text: string;
  /** Which backend actually ran the inference. */
  backend: Backend;
  /** Which model was actually used (may differ from config.modelId if Constellation routed elsewhere). */
  modelId: string;
  /** Quantization of the actual model used. */
  quantization: Quantization;
  /** Constellation's full routing decision for audit / debugging. */
  routingDecision: RoutingDecision;
  /** Wall-clock latency in ms (including routing overhead). */
  latencyMs: number;
  /** Token count from the backend. */
  tokenCount: number;
  /** Backend-specific metadata. */
  metadata?: Record<string, unknown>;
}

export class WebLLMEngine {
  private initialized = false;
  private config: WebLLMConfig | null = null;

  /**
   * Initialize the engine. Does NOT preload any model — Constellation
   * decides which model to load lazily on the first `generate()` call.
   */
  async init(config: WebLLMConfig): Promise<void> {
    this.config = config;
    this.initialized = true;

    // Initialize all registered backends (non-fatal on failure — HealthChecker
    // will mark unhealthy backends and Router will skip them).
    await getBackendRegistry().initAll();
  }

  /**
   * Generate text by routing through Constellation.
   *
   * Flow:
   *   1. Build a RoutingRequest from the prompt + config
   *   2. Call constellation.route() — picks optimal (backend, model, quant)
   *   3. Look up the BackendExecutor for the chosen backend
   *   4. Load the model if not already loaded
   *   5. Dispatch to backend.generate()
   *   6. Return result + routing metadata for audit
   *
   * Throws if Constellation cannot find a healthy backend within budget,
   * or if the chosen backend fails to load model / generate.
   */
  async generate(prompt: string): Promise<GenerateResult> {
    if (!this.initialized || !this.config) {
      throw new Error('WebLLMEngine not initialized — call init(config) first');
    }

    const startedAt = Date.now();

    // 1. Build routing request
    const routingRequest: RoutingRequest = {
      prompt,
      budget: this.config.budget,
      requireLocal: this.config.requireLocal,
      task: this.config.task,
    };

    // 2. Ask Constellation for a routing decision
    const decision = await constellation.route(routingRequest);

    // 3. Look up the BackendExecutor for the chosen backend
    const registry = getBackendRegistry();
    const executor = registry.get(decision.backend);
    if (!executor) {
      throw new Error(`No BackendExecutor registered for backend '${decision.backend}'`);
    }

    // 4. Initialize the backend if needed (lazy)
    if (!executor.isInitialized()) {
      try {
        // CloudBackend needs config — skip if not provided
        if (decision.backend === 'cloud') {
          throw new BackendError(decision.backend, 'not_initialized',
            'CloudBackend requires config — call init(config) on it directly');
        }
        await executor.init();
      } catch (e) {
        throw new Error(`Backend '${decision.backend}' init failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // 5. Load the model if not already loaded
    if (!executor.isModelLoaded() ||
        executor.getLoadedModel()?.modelId !== decision.modelId ||
        executor.getLoadedModel()?.quantization !== decision.quantization) {
      try {
        await executor.loadModel(decision.modelId, decision.quantization);
      } catch (e) {
        throw new Error(`Backend '${decision.backend}' loadModel('${decision.modelId}') failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // 6. Build the backend request
    const backendRequest: BackendRequest = {
      modelId: decision.modelId,
      quantization: decision.quantization,
      prompt,
      maxTokens: 256,
      temperature: 0.7,
      stream: false,
    };

    // 7. Dispatch
    let response: BackendResponse;
    try {
      response = await executor.generate(backendRequest);
    } catch (e) {
      throw new Error(`Backend '${decision.backend}' generate() failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    // 8. Return result with full audit metadata
    return {
      text: response.text,
      backend: response.backend,
      modelId: response.modelId,
      quantization: response.quantization,
      routingDecision: decision,
      latencyMs: Date.now() - startedAt,
      tokenCount: response.tokenCount,
      metadata: response.metadata,
    };
  }

  /** Shutdown — release all backend resources. */
  async shutdown(): Promise<void> {
    await getBackendRegistry().shutdownAll();
    this.initialized = false;
    this.config = null;
  }
}
