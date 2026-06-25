/**
 * Backends — index for src/constellation/backends/.
 *
 * AMOS v2.8 §5.1 backend priority (per architect's directive):
 *   1. GemmaBackend    (PRIMARY — Gemma 2B via llama.cpp Vulkan, already on device)
 *   2. MlcLlmBackend   (secondary — @mlc-ai/web-llm for sandbox path)
 *   3. WebLlmBackend   (tertiary — WebGPU for ArrowJS Sandbox + EPOCH)
 *   4. LlamdropBackend (fallback — CPU; stub until binary available)
 *   5. CloudBackend    (optional — only when requireLocal === false)
 *
 * QNN NPU deferred (Phase 4.3, requires QNN SDK access).
 */

export {
  type BackendExecutor,
  type BackendRequest,
  type BackendResponse,
  BackendError,
} from './BackendExecutor.js';
export { LlamaServerBackend, type LlamaServerConfig } from './LlamaServerBackend.js';

import type { BackendExecutor } from './BackendExecutor.js';
import type { Backend } from '../BackendRegistry.js';
import { MlcLlmBackend } from './MlcLlmBackend.js';
import { WebLlmBackend } from './WebLlmBackend.js';
import { LlamdropBackend } from './LlamdropBackend.js';
import { CloudBackend } from './CloudBackend.js';
import { GemmaBackend } from './GemmaBackend.js';
import { LlamaServerBackend } from './LlamaServerBackend.js';

/**
 * Registry of backend executor instances, keyed by Backend type.
 *
 * Each backend is a singleton — only one engine instance per backend type
 * at a time (to manage RAM carefully on mobile).
 */
export class BackendExecutorRegistry {
  private executors: Map<Backend, BackendExecutor> = new Map();

  /** Register a backend executor. Replaces any existing executor for this Backend. */
  register(executor: BackendExecutor): void {
    this.executors.set(executor.backend, executor);
  }

  /** Get the executor for a Backend, or undefined if not registered. */
  get(backend: Backend): BackendExecutor | undefined {
    return this.executors.get(backend);
  }

  /** List all registered backends. */
  list(): Backend[] {
    return Array.from(this.executors.keys());
  }

  /** Initialize all registered backends. */
  async initAll(): Promise<void> {
    for (const executor of this.executors.values()) {
      try {
        await executor.init();
      } catch {
        // Backend init failures are non-fatal — Constellation's HealthChecker
        // will mark unhealthy backends and Router will skip them.
      }
    }
  }

  /** Shutdown all registered backends. */
  async shutdownAll(): Promise<void> {
    for (const executor of this.executors.values()) {
      try {
        await executor.shutdown();
      } catch {
        // Ignore
      }
    }
  }

  /**
   * Register the AMOS v2.9 default backends.
   *
   * AMOS v2.9 (verified live on S25 Ultra):
   *   - LlamaServerBackend (PRIMARY — local llama-server at localhost:8080, already running)
   *   - GemmaBackend (secondary — native llama.cpp Vulkan, when built)
   *   - MlcLlmBackend (tertiary — @mlc-ai/web-llm for sandbox path)
   *   - WebLlmBackend (quaternary — WebGPU for ArrowJS Sandbox + EPOCH)
   *   - LlamdropBackend (fallback — CPU)
   *   - CloudBackend (optional — remote cloud APIs)
   *
   * LlamaServerBackend is PRIMARY because the user already has llama-server
   * running on the S25 Ultra with Gemma 2B loaded.
   * Verified: 27 tokens/second, 36.8ms/token, fully local.
   */
  registerDefaults(): void {
    this.register(new LlamaServerBackend()); // PRIMARY — localhost:8080
    this.register(new GemmaBackend());       // secondary (native, when built)
    this.register(new MlcLlmBackend());      // tertiary (browser sandbox)
    this.register(new WebLlmBackend());      // quaternary (browser)
    this.register(new LlamdropBackend());    // fallback
    this.register(new CloudBackend());       // optional
  }
}

/** Singleton instance. */
let _instance: BackendExecutorRegistry | null = null;

export function getBackendRegistry(): BackendExecutorRegistry {
  if (!_instance) {
    _instance = new BackendExecutorRegistry();
    _instance.registerDefaults();
  }
  return _instance;
}
