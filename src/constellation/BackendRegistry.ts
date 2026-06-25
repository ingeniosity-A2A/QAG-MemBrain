/**
 * BackendRegistry — catalog of available inference backends.
 *
 * Each backend is registered with its capabilities, default model,
 * default quantization, and quality score (0..1).
 *
 * In production, backends self-register on startup (e.g. QNN NPU
 * plugin probes the device, WebGPU context probes the browser,
 * cloud backends ping their endpoints).
 */

export type Backend =
  | 'qnn_npu'    // Hexagon NPU via QNN SDK
  | 'webgpu'     // Adreno GPU via WebGPU
  | 'cpu'        // CPU fallback
  | 'llamdrop'   // llamdrop local runtime
  | 'cloud';     // Cloud endpoint (only if requireLocal === false)

export type Quantization = 'q0f32' | 'q4f16' | 'q4f32' | 't_man_1.58';

export interface BackendInfo {
  backend: Backend;
  /** Default model ID for this backend */
  defaultModelId: string;
  /** Default quantization for this backend */
  defaultQuantization: Quantization;
  /** Quality score 0..1 — used by Router for scoring */
  quality: number;
  /** Supported task types */
  tasks: Array<'reflex' | 'planning' | 'code' | 'math' | 'reasoning' | 'general'>;
  /** Static capabilities */
  capabilities: {
    maxContextLength: number;
    supportsStreaming: boolean;
    supportsTools: boolean;
    supportsJsonMode: boolean;
  };
}

export class BackendRegistry {
  private backends: Map<Backend, BackendInfo> = new Map();

  register(info: BackendInfo): void {
    this.backends.set(info.backend, info);
  }

  unregister(backend: Backend): void {
    this.backends.delete(backend);
  }

  get(backend: Backend): BackendInfo | undefined {
    return this.backends.get(backend);
  }

  list(): BackendInfo[] {
    return Array.from(this.backends.values());
  }

  /** Convenience: register default AMOS v2.1 backends. */
  registerDefaults(): void {
    this.register({
      backend: 'qnn_npu',
      defaultModelId: 'gemma-2-9b-it-q4f16_1',
      defaultQuantization: 'q4f16',
      quality: 0.85,
      tasks: ['reflex', 'code', 'math', 'reasoning', 'general'],
      capabilities: {
        maxContextLength: 8192,
        supportsStreaming: true,
        supportsTools: false,
        supportsJsonMode: false,
      },
    });
    this.register({
      backend: 'webgpu',
      defaultModelId: 'gemma-2-9b-it-q4f16_1',
      defaultQuantization: 'q4f16',
      quality: 0.78,
      tasks: ['reflex', 'planning', 'code', 'math', 'reasoning', 'general'],
      capabilities: {
        maxContextLength: 8192,
        supportsStreaming: true,
        supportsTools: true,
        supportsJsonMode: true,
      },
    });
    this.register({
      backend: 'cpu',
      defaultModelId: 'gemma-2-9b-it-q4f32',
      defaultQuantization: 'q4f32',
      quality: 0.65,
      tasks: ['general'],
      capabilities: {
        maxContextLength: 4096,
        supportsStreaming: true,
        supportsTools: false,
        supportsJsonMode: false,
      },
    });
    this.register({
      backend: 'llamdrop',
      defaultModelId: 'llamdrop-default',
      defaultQuantization: 't_man_1.58',
      quality: 0.70,
      tasks: ['reflex', 'general'],
      capabilities: {
        maxContextLength: 2048,
        supportsStreaming: false,
        supportsTools: false,
        supportsJsonMode: false,
      },
    });
    this.register({
      backend: 'cloud',
      defaultModelId: 'gemma-2b',
      defaultQuantization: 'q4f16',
      quality: 0.95,
      tasks: ['reflex', 'planning', 'code', 'math', 'reasoning', 'general'],
      capabilities: {
        maxContextLength: 8192,
        supportsStreaming: true,
        supportsTools: true,
        supportsJsonMode: true,
      },
    });
  }
}
