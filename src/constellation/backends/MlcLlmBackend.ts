/**
 * MlcLlmBackend — primary local inference backend using MLC-LLM.
 *
 * AMOS v2.6 §5.1 — Primary backend (Vulkan/OpenCL on Adreno GPU).
 *
 * Real `@mlc-ai/web-llm` API:
 *   import { CreateMLCEngine, MLCEngineInterface } from '@mlc-ai/web-llm';
 *   const engine = await CreateMLCEngine(modelId, { initProgressCallback });
 *   const reply = await engine.chat.completions.create({
 *     messages: [{ role: 'user', content: prompt }],
 *     stream: false,
 *     temperature: 0.7,
 *   });
 *   // reply.choices[0].message.content === string
 *
 * For streaming:
 *   const stream = await engine.chat.completions.create({
 *     messages: [...],
 *     stream: true,
 *   });
 *   for await (const chunk of stream) {
 *     const delta = chunk.choices[0]?.delta?.content ?? '';
 *     onToken(delta);
 *   }
 *
 * MLC-LLM is lazy-loaded so this module is importable even before
 * `npm install @mlc-ai/web-llm`. The lazy import is wrapped in a
 * try/catch that throws BackendError('not_initialized') if the package
 * is missing.
 *
 * Real models that work on Adreno today (per MLC-LLM docs):
 *   - Llama-3.2-3B-Instruct-q4f16_1-MLC       (~2 GB, fast)
 *   - gemma-2-2b-it-q4f16_1-MLC                (~1.5 GB, lighter)
 *   - Qwen2.5-7B-Instruct-q4f16_1-MLC          (~4.5 GB, quality)
 *   - Llama-3.1-8B-Instruct-q4f16_1-MLC        (~5 GB, quality)
 *
 * Target latency on S25 Ultra Adreno 750:
 *   - 3B Q4: 60-150ms first-token, 20-40 tok/sec sustained
 *   - 7B Q4: 150-300ms first-token, 10-20 tok/sec sustained
 */

import type { Backend, Quantization } from '../BackendRegistry.js';
import {
  type BackendExecutor,
  type BackendRequest,
  type BackendResponse,
  BackendError,
} from './BackendExecutor.js';

/**
 * Minimal interface for the @mlc-ai/web-llm module.
 * Avoids importing the real types (which require the package to be installed).
 */
interface MlcLlmModule {
  CreateMLCEngine: (
    modelId: string,
    options?: {
      initProgressCallback?: (info: { progress: number; timeElapsed: number }) => void;
      model?: string;
    },
  ) => Promise<MlcLlmEngine>;
}

interface MlcLlmEngine {
  chat: {
    completions: {
      create: (params: {
        messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
        stream?: boolean;
        temperature?: number;
        max_tokens?: number;
      }) => Promise<MlcLlmChatCompletion | AsyncIterable<MlcLlmChatChunk>>;
    };
  };
  unload: () => Promise<void>;
}

interface MlcLlmChatCompletion {
  choices: Array<{
    message: { content: string };
    finish_reason?: string;
  }>;
  usage?: { completion_tokens?: number };
}

interface MlcLlmChatChunk {
  choices: Array<{
    delta: { content?: string };
    finish_reason?: string;
  }>;
}

export class MlcLlmBackend implements BackendExecutor {
  readonly backend: Backend = 'webgpu'; // MLC-LLM runs on WebGPU/Vulkan; we map to 'webgpu' Backend type

  private mlcModule: MlcLlmModule | null = null;
  private engine: MlcLlmEngine | null = null;
  private initialized = false;
  private loadedModel: { modelId: string; quantization: Quantization } | null = null;
  private initProgress: number = 0;

  isInitialized(): boolean {
    return this.initialized;
  }

  isModelLoaded(): boolean {
    return this.engine !== null && this.loadedModel !== null;
  }

  getLoadedModel(): { modelId: string; quantization: Quantization } | null {
    return this.loadedModel;
  }

  /**
   * Initialize the backend by lazy-loading @mlc-ai/web-llm.
   * Does NOT load any model — that's done by `loadModel()`.
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    try {
      // @ts-ignore — lazy-load @mlc-ai/web-llm; not installed in dev env
      const mod: MlcLlmModule = await import('@mlc-ai/web-llm');
      if (!mod || typeof mod.CreateMLCEngine !== 'function') {
        throw new Error('CreateMLCEngine not found in @mlc-ai/web-llm');
      }
      this.mlcModule = mod;
      this.initialized = true;
    } catch (e) {
      throw new BackendError(
        this.backend,
        'not_initialized',
        `Failed to load @mlc-ai/web-llm: ${e instanceof Error ? e.message : String(e)}. ` +
          `Run: npm install @mlc-ai/web-llm`,
        e,
      );
    }
  }

  /**
   * Load a model into MLC-LLM. May be a no-op if the requested model is already loaded.
   *
   * Throws BackendError('model_load_failed') if:
   *   - Backend not initialized (call init() first)
   *   - Model not found in MLC-LLM model registry
   *   - Device doesn't have enough RAM/VRAM
   *   - WebGPU not available (older browsers / non-HTTPS context)
   */
  async loadModel(modelId: string, quantization: Quantization): Promise<void> {
    if (!this.initialized || !this.mlcModule) {
      throw new BackendError(this.backend, 'not_initialized', 'Call init() before loadModel()');
    }

    // No-op if already loaded
    if (this.loadedModel?.modelId === modelId && this.loadedModel?.quantization === quantization) {
      return;
    }

    // Unload previous model first
    if (this.engine) {
      try {
        await this.engine.unload();
      } catch {
        // Ignore unload errors
      }
      this.engine = null;
      this.loadedModel = null;
    }

    // MLC-LLM model IDs embed the quantization suffix (e.g. '-q4f16_1-MLC').
    // If the caller passed a bare model name, append the quantization suffix.
    const fullModelId = modelId.includes('-q') ? modelId : `${modelId}-${quantizationToSuffix(quantization)}-MLC`;

    try {
      this.initProgress = 0;
      this.engine = await this.mlcModule.CreateMLCEngine(fullModelId, {
        initProgressCallback: (info) => {
          this.initProgress = info.progress;
        },
      });
      this.loadedModel = { modelId: fullModelId, quantization };
    } catch (e) {
      throw new BackendError(
        this.backend,
        'model_load_failed',
        `Failed to load model '${fullModelId}': ${e instanceof Error ? e.message : String(e)}`,
        e,
      );
    }
  }

  /**
   * Generate text using MLC-LLM.
   *
   * If request.stream === true and request.onToken is provided, tokens are
   * streamed via onToken. The full aggregated text is still returned in
   * BackendResponse.text.
   */
  async generate(request: BackendRequest): Promise<BackendResponse> {
    if (!this.initialized || !this.mlcModule) {
      throw new BackendError(this.backend, 'not_initialized', 'Call init() before generate()');
    }
    if (!this.engine || !this.loadedModel) {
      throw new BackendError(
        this.backend,
        'not_initialized',
        `No model loaded. Call loadModel() first.`,
      );
    }

    const startedAt = Date.now();
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
    if (request.systemPrompt) {
      messages.push({ role: 'system', content: request.systemPrompt });
    }
    messages.push({ role: 'user', content: request.prompt });

    const params = {
      messages,
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens ?? 256,
    };

    let text: string;
    let tokenCount: number;

    try {
      if (request.stream && request.onToken) {
        // Streaming path
        const stream = (await this.engine.chat.completions.create({ ...params, stream: true })) as AsyncIterable<MlcLlmChatChunk>;
        let aggregated = '';
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content ?? '';
          if (delta) {
            aggregated += delta;
            request.onToken(delta);
          }
        }
        text = aggregated;
        tokenCount = estimateTokenCount(text);
      } else {
        // Non-streaming path
        const completion = (await this.engine.chat.completions.create({ ...params, stream: false })) as MlcLlmChatCompletion;
        text = completion.choices[0]?.message?.content ?? '';
        tokenCount = completion.usage?.completion_tokens ?? estimateTokenCount(text);
      }
    } catch (e) {
      throw new BackendError(
        this.backend,
        'inference_failed',
        `Inference failed: ${e instanceof Error ? e.message : String(e)}`,
        e,
      );
    }

    const latencyMs = Date.now() - startedAt;

    return {
      text,
      tokenCount,
      latencyMs,
      backend: this.backend,
      modelId: this.loadedModel.modelId,
      quantization: this.loadedModel.quantization,
      metadata: {
        tokensPerSec: tokenCount > 0 ? (tokenCount / latencyMs) * 1000 : 0,
        initProgress: this.initProgress,
      },
    };
  }

  async unload(): Promise<void> {
    if (this.engine) {
      try {
        await this.engine.unload();
      } catch {
        // Ignore
      }
      this.engine = null;
      this.loadedModel = null;
    }
  }

  async shutdown(): Promise<void> {
    await this.unload();
    this.mlcModule = null;
    this.initialized = false;
  }
}

/**
 * Convert AMOS Quantization enum to MLC-LLM model ID suffix.
 *
 * MLC-LLM uses suffixes like:
 *   - q4f16_1   (4-bit weights, 16-bit float, version 1)
 *   - q4f32_1   (4-bit weights, 32-bit float, version 1)
 *   - q0f16     (no quantization, 16-bit float)
 *   - q0f32     (no quantization, 32-bit float)
 */
function quantizationToSuffix(q: Quantization): string {
  switch (q) {
    case 'q4f16': return 'q4f16_1';
    case 'q4f32': return 'q4f32_1';
    case 'q0f32': return 'q0f32';
    case 't_man_1.58': return 'q2_k_xl'; // Approximate — T-MAN 1.58-bit maps closest to 2-bit
    default: return 'q4f16_1';
  }
}

/**
 * Rough token count estimate when the backend doesn't report one.
 * Average: 4 chars per token for English text.
 */
function estimateTokenCount(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}
