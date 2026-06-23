/**
 * CloudBackend — optional cloud escalation backend.
 *
 * AMOS v2.6 §5.1 — Optional backend (only when requireLocal === false).
 *
 * Per the architect's directive:
 *   "Cloud API (optional)"
 *
 * Per AMOS v2.6 §5.2 — Real models only:
 *   - GLM-4-Plus (Z.ai)
 *   - GPT-4o (OpenAI)
 *   - Claude 3.5 Sonnet (Anthropic)
 *
 * Status: STUB. Real implementation will use fetch() to call cloud APIs.
 * Throws BackendError('unsupported') until real API keys + endpoints are
 * configured.
 *
 * Security:
 *   - API keys NEVER in payload — only in env vars
 *   - Meta Harness redaction policy scrubs PII before cloud calls
 *   - requireLocal must be false for Constellation to route here
 */

import type { Backend, Quantization } from '../BackendRegistry.js';
import {
  type BackendExecutor,
  type BackendRequest,
  type BackendResponse,
  BackendError,
} from './BackendExecutor.js';

export interface CloudBackendConfig {
  /** Cloud provider */
  provider: 'zai' | 'openai' | 'anthropic' | 'custom';
  /** API endpoint URL */
  endpoint: string;
  /** API key (from env var, NEVER hardcoded) */
  apiKey: string;
  /** Default model ID for this provider */
  defaultModelId: string;
}

export class CloudBackend implements BackendExecutor {
  readonly backend: Backend = 'cloud';

  private initialized = false;
  private config: CloudBackendConfig | null = null;
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
   * Initialize with cloud config. The config MUST come from env vars,
   * not hardcoded values.
   *
   * Example:
   *   cloudBackend.init({
   *     provider: 'zai',
   *     endpoint: process.env.ZAI_API_ENDPOINT!,
   *     apiKey: process.env.ZAI_API_KEY!,
   *     defaultModelId: 'glm-4-plus',
   *   });
   */
  async init(config?: CloudBackendConfig): Promise<void> {
    if (this.initialized) return;
    if (!config) {
      throw new BackendError(
        this.backend,
        'not_initialized',
        'CloudBackend requires config with endpoint + apiKey. Pass via init(config).',
      );
    }
    if (!config.apiKey) {
      throw new BackendError(
        this.backend,
        'not_initialized',
        'CloudBackend config.apiKey is empty. Set it from an env var, never hardcode.',
      );
    }
    this.config = config;
    this.initialized = true;
  }

  async loadModel(modelId: string, quantization: Quantization): Promise<void> {
    if (!this.initialized) {
      throw new BackendError(this.backend, 'not_initialized', 'Call init(config) first');
    }
    // Cloud backends don't actually "load" models — just record what was requested
    this.loadedModel = { modelId, quantization };
  }

  async generate(request: BackendRequest): Promise<BackendResponse> {
    if (!this.initialized || !this.config || !this.loadedModel) {
      throw new BackendError(this.backend, 'not_initialized', 'Backend not initialized');
    }

    const startedAt = Date.now();

    try {
      // Real implementation would build provider-specific request body.
      // For now: stub that throws 'unsupported'.
      throw new Error('Cloud backend not yet implemented — configure provider + endpoint');
    } catch (e) {
      throw new BackendError(
        this.backend,
        'inference_failed',
        `Cloud inference failed: ${e instanceof Error ? e.message : String(e)}`,
        e,
      );
    }

    // Unreachable today — when implemented, this returns:
    // return {
    //   text: responseText,
    //   tokenCount,
    //   latencyMs: Date.now() - startedAt,
    //   backend: this.backend,
    //   modelId: this.loadedModel.modelId,
    //   quantization: this.loadedModel.quantization,
    //   metadata: { provider: this.config.provider, costUsd: ... },
    // };
  }

  async unload(): Promise<void> {
    this.loadedModel = null;
  }

  async shutdown(): Promise<void> {
    await this.unload();
    this.config = null;
    this.initialized = false;
  }
}
