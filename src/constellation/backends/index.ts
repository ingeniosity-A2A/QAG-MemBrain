/**
 * Backends — index for src/constellation/backends/.
 *
 * AMOS v2.6 §5.1 backend priority:
 *   1. MlcLlmBackend    (primary — local Vulkan/OpenCL on Adreno)
 *   2. WebLlmBackend     (secondary — WebGPU for ArrowJS Sandbox + EPOCH)
 *   3. LlamdropBackend   (fallback — CPU; stub until binary available)
 *   4. CloudBackend      (optional — only when requireLocal === false)
 *
 * QNN NPU deferred (Phase 4.3, requires QNN SDK access).
 */

export {
  type BackendExecutor,
  type BackendRequest,
  type BackendResponse,
  BackendError,
} from './BackendExecutor.js';
export { MlcLlmBackend } from './MlcLlmBackend.js';
export { WebLlmBackend } from './WebLlmBackend.js';
export { LlamdropBackend } from './LlamdropBackend.js';
export { CloudBackend, type CloudBackendConfig } from './CloudBackend.js';

import type { BackendExecutor } from './BackendExecutor.js';
import type { Backend } from '../BackendRegistry.js';
import { MlcLlmBackend } from './MlcLlmBackend.js';
import { WebLlmBackend } from './WebLlmBackend.js';
import { LlamdropBackend } from './LlamdropBackend.js';
import { CloudBackend } from './CloudBackend.js';

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
   * Convenience: register the AMOS v2.6 default backends.
   *
   * Per architect's directive:
   *   - MLC-LLM (primary)
   *   - WebLLM  (sandbox/UI)
   *   - llamdrop (CPU fallback — stub)
   *   - Cloud   (optional — caller must init() with config before use)
   *
   * QNN NPU is NOT registered (deferred per Phase 4.3).
   */
  registerDefaults(): void {
    this.register(new MlcLlmBackend());
    this.register(new WebLlmBackend());
    this.register(new LlamdropBackend());
    this.register(new CloudBackend());
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
