/**
 * LlamdropBackend — CPU fallback when GPU is unavailable.
 *
 * AMOS v2.6 §5.1 — Fallback backend (CPU).
 *
 * Per the architect's directive:
 *   "llamdrop as the lightweight CPU/Vulkan fallback"
 *
 * Status: STUB. llamdrop is a custom local LLM runtime that doesn't have
 * a public binary yet. This class throws BackendError('unsupported') for
 * all operations until a real llamdrop binary is available.
 *
 * When llamdrop is released, the implementation will:
 *   1. Spawn a llamdrop subprocess (or load .so via JNI on Android)
 *   2. Pipe prompts via stdin, read responses via stdout
 *   3. Support 1.58-bit T-MAN quantization (lightest weight)
 *
 * Target use case: keep AVA007 responsive when Adreno GPU is throttled
 * or unavailable (e.g. on devices without WebGPU support).
 */

import type { Backend, Quantization } from '../BackendRegistry.js';
import {
  type BackendExecutor,
  type BackendRequest,
  type BackendResponse,
  BackendError,
} from './BackendExecutor.js';

export class LlamdropBackend implements BackendExecutor {
  readonly backend: Backend = 'llamdrop';

  private initialized = false;
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

  async init(): Promise<void> {
    // llamdrop binary not yet available — init is a no-op stub
    this.initialized = true;
  }

  async loadModel(modelId: string, quantization: Quantization): Promise<void> {
    if (!this.initialized) {
      throw new BackendError(this.backend, 'not_initialized', 'Call init() first');
    }
    // Stub: just record what was requested
    this.loadedModel = { modelId, quantization };
  }

  async generate(_request: BackendRequest): Promise<BackendResponse> {
    throw new BackendError(
      this.backend,
      'unsupported',
      'llamdrop runtime not yet available. Use MlcLlmBackend or WebLlmBackend instead.',
    );
  }

  async unload(): Promise<void> {
    this.loadedModel = null;
  }

  async shutdown(): Promise<void> {
    await this.unload();
    this.initialized = false;
  }
}
