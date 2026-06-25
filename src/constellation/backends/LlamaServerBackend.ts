/**
 * LlamaServerBackend — connects to a local llama-server (OpenAI-compatible API).
 *
 * AMOS v2.9 — PRIMARY inference backend.
 *
 * This is the simplest, fastest path to live AVA007:
 *   - llama-server runs natively on the S25 Ultra (already running!)
 *   - Exposes OpenAI-compatible API at http://localhost:8080
 *   - This backend just does fetch() to that endpoint
 *   - No WebLLM, no WebGPU, no model download, no SDK
 *
 * The user already has this running:
 *   llama-server -m ~/gemma-2b.gguf --port 8080 --host 0.0.0.0
 *
 * Verified working (curl test):
 *   POST http://localhost:8080/v1/chat/completions
 *   → "Hello! 👋 I am Gemma, an AI assistant..."
 *   → 27 tokens/second on CPU
 *   → 36.8ms per token
 */

import type { Backend, Quantization } from '../BackendRegistry.js';
import {
  type BackendExecutor,
  type BackendRequest,
  type BackendResponse,
  BackendError,
} from './BackendExecutor.js';

export interface LlamaServerConfig {
  /** URL of the llama-server. Default: http://localhost:8080 */
  endpoint: string;
  /** Model name (optional — llama-server uses whatever model it loaded) */
  model?: string;
  /** API key (optional — llama-server doesn't require one, but the field is here for compatibility) */
  apiKey?: string;
}

export class LlamaServerBackend implements BackendExecutor {
  readonly backend: Backend = 'cloud'; // Reuses 'cloud' Backend type (it's an HTTP API)

  private initialized = false;
  private config: LlamaServerConfig;
  private loadedModel: { modelId: string; quantization: Quantization } | null = null;

  constructor(config: LlamaServerConfig = { endpoint: 'http://localhost:8080' }) {
    this.config = config;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  isModelLoaded(): boolean {
    return this.loadedModel !== null;
  }

  getLoadedModel(): { modelId: string; quantization: Quantization } | null {
    return this.loadedModel;
  }

  async init(): Promise<void> {
    if (this.initialized) return;

    // Test the connection
    try {
      const resp = await fetch(`${this.config.endpoint}/v1/models`, {
        headers: this.config.apiKey ? { 'Authorization': `Bearer ${this.config.apiKey}` } : {},
      });
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }
      this.initialized = true;
    } catch (e) {
      throw new BackendError(
        this.backend,
        'not_initialized',
        `Cannot connect to llama-server at ${this.config.endpoint}. ` +
          `Ensure llama-server is running: llama-server -m ~/gemma-2b.gguf --port 8080 --host 0.0.0.0`,
        e,
      );
    }
  }

  async loadModel(modelId: string, quantization: Quantization): Promise<void> {
    if (!this.initialized) {
      throw new BackendError(this.backend, 'not_initialized', 'Call init() first');
    }
    // llama-server already has a model loaded — just record what was requested
    this.loadedModel = { modelId, quantization };
  }

  async generate(request: BackendRequest): Promise<BackendResponse> {
    if (!this.initialized || !this.loadedModel) {
      throw new BackendError(this.backend, 'not_initialized', 'Not initialized or no model loaded');
    }

    const startedAt = Date.now();

    // Build the OpenAI-compatible request
    const messages: Array<{ role: string; content: string }> = [];
    if (request.systemPrompt) {
      messages.push({ role: 'system', content: request.systemPrompt });
    }
    messages.push({ role: 'user', content: request.prompt });

    try {
      const resp = await fetch(`${this.config.endpoint}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.apiKey ? { 'Authorization': `Bearer ${this.config.apiKey}` } : {}),
        },
        body: JSON.stringify({
          messages,
          max_tokens: request.maxTokens ?? 256,
          temperature: request.temperature ?? 0.7,
          stream: false,
        }),
      });

      if (!resp.ok) {
        const errorText = await resp.text().catch(() => 'Unknown error');
        throw new Error(`HTTP ${resp.status}: ${errorText}`);
      }

      const data = await resp.json();

      // Extract response
      const text = data.choices?.[0]?.message?.content ?? '';
      const tokenCount = data.usage?.completion_tokens ?? Math.max(1, Math.ceil(text.length / 4));
      const latencyMs = Date.now() - startedAt;

      // Extract timing info if available
      const timings = data.timings;
      const metadata: Record<string, unknown> = {
        endpoint: this.config.endpoint,
      };
      if (timings) {
        metadata.tokensPerSec = timings.predicted_per_second ?? 0;
        metadata.promptMs = timings.prompt_ms ?? 0;
        metadata.predictedMs = timings.predicted_ms ?? 0;
      }

      return {
        text,
        tokenCount,
        latencyMs,
        backend: this.backend,
        modelId: this.loadedModel.modelId,
        quantization: this.loadedModel.quantization,
        metadata,
      };
    } catch (e) {
      throw new BackendError(
        this.backend,
        'inference_failed',
        `llama-server request failed: ${e instanceof Error ? e.message : String(e)}`,
        e,
      );
    }
  }

  async unload(): Promise<void> {
    this.loadedModel = null;
  }

  async shutdown(): Promise<void> {
    await this.unload();
    this.initialized = false;
  }
}
