import { WebLLMRuntime, InferenceRequest, InferenceResponse, ContextBuffer } from './Runtime.js';
import { getPreferredModel } from './ModelRegistry.js';

export class VibeThinkerProvider {
  private runtime: WebLLMRuntime;

  constructor(runtime: WebLLMRuntime) {
    this.runtime = runtime;
  }

  async initialize(): Promise<void> {
    const preferred = getPreferredModel();
    await this.runtime.initialize(preferred.modelId);
  }

  async infer(context: ContextBuffer, options?: {
    temperature?: number;
    maxTokens?: number;
  }): Promise<InferenceResponse> {
    const request: InferenceRequest = {
      context,
      temperature: options?.temperature ?? 0.3,
      maxTokens: options?.maxTokens ?? 2048,
    };

    return this.runtime.infer(request);
  }

  async inferWithFallback(
    context: ContextBuffer, 
    options?: { temperature?: number; maxTokens?: number }
  ): Promise<InferenceResponse> {
    try {
      return await this.infer(context, options);
    } catch (error) {
      console.warn('[VibeThinker] Primary inference failed, attempting fallback:', error);
      return this.fallbackInfer(context, options);
    }
  }

  private async fallbackInfer(
    context: ContextBuffer, 
    options?: { temperature?: number; maxTokens?: number }
  ): Promise<InferenceResponse> {
    await this.runtime.switchModel('gemma-2-2b-it-q4f16_1');
    return this.runtime.infer({
      context,
      temperature: options?.temperature ?? 0.5,
      maxTokens: options?.maxTokens ?? 1024,
    });
  }

  isReady(): boolean {
    return this.runtime.isReady();
  }

  getCurrentModel(): string {
    return this.runtime.getCurrentModel()?.modelId ?? 'unknown';
  }
}

export const vibeThinkerProvider = new VibeThinkerProvider(new WebLLMRuntime());