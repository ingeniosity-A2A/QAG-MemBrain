/**
 * WebLlmBackend — secondary backend for ArrowJS Sandbox + EPOCH UI agents.
 *
 * AMOS v2.6 §5.1 — Secondary backend (WebGPU via @mlc-ai/web-llm).
 *
 * Per the architect's directive:
 *   "Keep WebLLM. Don't remove it. Use it exclusively for:
 *    ArrowJS Sandbox, EPOCH UI, Plugin testing, Browser extensions,
 *    Hot-swappable agents. It isolates experimental code from your
 *    core runtime."
 *
 * Architecture:
 *   User UI → ArrowJS Sandbox → WebLlmBackend (this module)
 *
 * Difference from MlcLlmBackend:
 *   - MlcLlmBackend is the PRIMARY path for AVA007's core runtime
 *   - WebLlmBackend is for ISOLATED experimental / UI code paths
 *   - Both use @mlc-ai/web-llm under the hood (same package, same WebGPU)
 *   - But they maintain SEPARATE engine instances so an experimental
 *     agent crashing doesn't take down AVA007's primary inference
 *
 * In practice, this class is almost identical to MlcLlmBackend. The
 * separation is architectural / organizational, not technical. Keeping
 * them as separate classes makes the boundary explicit in code reviews
 * and prevents accidental coupling.
 */

import type { Backend, Quantization } from '../BackendRegistry.js';
import {
  type BackendExecutor,
  type BackendRequest,
  type BackendResponse,
  BackendError,
} from './BackendExecutor.js';

interface MlcLlmModule {
  CreateMLCEngine: (
    modelId: string,
    options?: {
      initProgressCallback?: (info: { progress: number; timeElapsed: number }) => void;
    },
  ) => Promise<WebLlmEngine>;
}

interface WebLlmEngine {
  chat: {
    completions: {
      create: (params: {
        messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
        stream?: boolean;
        temperature?: number;
        max_tokens?: number;
      }) => Promise<WebLlmChatCompletion | AsyncIterable<WebLlmChatChunk>>;
    };
  };
  unload: () => Promise<void>;
}

interface WebLlmChatCompletion {
  choices: Array<{
    message: { content: string };
  }>;
  usage?: { completion_tokens?: number };
}

interface WebLlmChatChunk {
  choices: Array<{
    delta: { content?: string };
  }>;
}

export class WebLlmBackend implements BackendExecutor {
  readonly backend: Backend = 'webgpu';

  private mlcModule: MlcLlmModule | null = null;
  private engine: WebLlmEngine | null = null;
  private initialized = false;
  private loadedModel: { modelId: string; quantization: Quantization } | null = null;

  isInitialized(): boolean {
    return this.initialized;
  }

  isModelLoaded(): boolean {
    return this.engine !== null && this.loadedModel !== null;
  }

  getLoadedModel(): { modelId: string; quantization: Quantization } | null {
    return this.loadedModel;
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    try {
      // @ts-ignore — lazy-load @mlc-ai/web-llm
      const mod: MlcLlmModule = await import('@mlc-ai/web-llm');
      if (!mod || typeof mod.CreateMLCEngine !== 'function') {
        throw new Error('CreateMLCEngine not found');
      }
      this.mlcModule = mod;
      this.initialized = true;
    } catch (e) {
      throw new BackendError(
        this.backend,
        'not_initialized',
        `Failed to load @mlc-ai/web-llm: ${e instanceof Error ? e.message : String(e)}`,
        e,
      );
    }
  }

  async loadModel(modelId: string, quantization: Quantization): Promise<void> {
    if (!this.initialized || !this.mlcModule) {
      throw new BackendError(this.backend, 'not_initialized', 'Call init() first');
    }
    if (this.loadedModel?.modelId === modelId && this.loadedModel?.quantization === quantization) {
      return;
    }
    if (this.engine) {
      try { await this.engine.unload(); } catch { /* ignore */ }
      this.engine = null;
      this.loadedModel = null;
    }
    const fullModelId = modelId.includes('-q') ? modelId : `${modelId}-${quantizationToSuffix(quantization)}-MLC`;
    try {
      this.engine = await this.mlcModule.CreateMLCEngine(fullModelId);
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

  async generate(request: BackendRequest): Promise<BackendResponse> {
    if (!this.initialized || !this.engine || !this.loadedModel) {
      throw new BackendError(this.backend, 'not_initialized', 'Backend not initialized or no model loaded');
    }
    const startedAt = Date.now();
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
    if (request.systemPrompt) messages.push({ role: 'system', content: request.systemPrompt });
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
        const stream = (await this.engine.chat.completions.create({ ...params, stream: true })) as AsyncIterable<WebLlmChatChunk>;
        let aggregated = '';
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content ?? '';
          if (delta) {
            aggregated += delta;
            request.onToken(delta);
          }
        }
        text = aggregated;
        tokenCount = Math.max(1, Math.ceil(text.length / 4));
      } else {
        const completion = (await this.engine.chat.completions.create({ ...params, stream: false })) as WebLlmChatCompletion;
        text = completion.choices[0]?.message?.content ?? '';
        tokenCount = completion.usage?.completion_tokens ?? Math.max(1, Math.ceil(text.length / 4));
      }
    } catch (e) {
      throw new BackendError(
        this.backend,
        'inference_failed',
        `Inference failed: ${e instanceof Error ? e.message : String(e)}`,
        e,
      );
    }
    return {
      text,
      tokenCount,
      latencyMs: Date.now() - startedAt,
      backend: this.backend,
      modelId: this.loadedModel.modelId,
      quantization: this.loadedModel.quantization,
    };
  }

  async unload(): Promise<void> {
    if (this.engine) {
      try { await this.engine.unload(); } catch { /* ignore */ }
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

function quantizationToSuffix(q: Quantization): string {
  switch (q) {
    case 'q4f16': return 'q4f16_1';
    case 'q4f32': return 'q4f32_1';
    case 'q0f32': return 'q0f32';
    case 't_man_1.58': return 'q2_k_xl';
    default: return 'q4f16_1';
  }
}
