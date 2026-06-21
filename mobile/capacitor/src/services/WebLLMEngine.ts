// Placeholder — Constellation pillar (WebLLM inference engine)
// Routes through Meta Harness before any model invocation
export interface WebLLMConfig {
  modelId: string;
  contextLength: number;
  quantization: 'q4f16_1' | 'q4f32_1' | 'q0f32';
}

export class WebLLMEngine {
  // Stub — actual WebLLM integration pending
  async init(_config: WebLLMConfig): Promise<void> {
    throw new Error('WebLLMEngine.init — not implemented (placeholder)');
  }
  async generate(_prompt: string): Promise<string> {
    throw new Error('WebLLMEngine.generate — not implemented (placeholder)');
  }
}
