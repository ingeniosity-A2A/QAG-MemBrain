import { CreateMLCEngine, MLCEngine } from '@mlc-ai/web-llm';

export interface ModelConfig {
  modelId: string;
  contextWindow: number;
  preferred?: boolean;
  fallback?: boolean;
}

export interface InferenceRequest {
  context: ContextBuffer;
  temperature?: number;
  maxTokens?: number;
  stopSequences?: string[];
}

export interface InferenceResponse {
  text: string;
  tokens: number;
  model: string;
  latency: number;
}

export interface ContextBuffer {
  objective: Uint32Array;
  memoryRefs: Uint32Array;
  graphRefs: Uint32Array;
  policyRefs: Uint32Array;
  toolRefs: Uint32Array;
}

export class WebLLMRuntime {
  private engine: MLCEngine | null = null;
  private currentModel: ModelConfig | null = null;
  private modelRegistry: Map<string, ModelConfig> = new Map();

  registerModel(config: ModelConfig): void {
    this.modelRegistry.set(config.modelId, config);
  }

  async initialize(preferredModelId?: string): Promise<void> {
    const preferred = preferredModelId 
      ? this.modelRegistry.get(preferredModelId)
      : this.getPreferredModel();

    if (!preferred) {
      throw new Error('No preferred model registered');
    }

    await this.loadModel(preferred);
  }

  private getPreferredModel(): ModelConfig | undefined {
    for (const [, config] of this.modelRegistry) {
      if (config.preferred) return config;
    }
    return undefined;
  }

  private async loadModel(config: ModelConfig): Promise<void> {
    this.engine = await CreateMLCEngine(config.modelId, {
      initProgressCallback: (progress) => {
        console.log(`[WebLLM] Loading ${config.modelId}: ${progress.text}`);
      },
    });
    this.currentModel = config;
  }

  async infer(request: InferenceRequest): Promise<InferenceResponse> {
    if (!this.engine || !this.currentModel) {
      throw new Error('Runtime not initialized');
    }

    const start = performance.now();
    
    const prompt = this.assemblePrompt(request.context);
    
    const response = await this.engine.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      temperature: request.temperature ?? 0.3,
      max_tokens: request.maxTokens ?? 2048,
      stop: request.stopSequences,
    });

    const text = response.choices[0]?.message?.content ?? '';
    const latency = performance.now() - start;

    return {
      text,
      tokens: response.usage?.completion_tokens ?? 0,
      model: this.currentModel.modelId,
      latency,
    };
  }

  private assemblePrompt(buffer: ContextBuffer): string {
    const sections: string[] = [];

    if (buffer.objective.length > 0) {
      sections.push(`OBJECTIVE: ${this.decodeBuffer(buffer.objective)}`);
    }

    if (buffer.memoryRefs.length > 0) {
      sections.push(`MEMORY: ${this.decodeBuffer(buffer.memoryRefs)}`);
    }

    if (buffer.graphRefs.length > 0) {
      sections.push(`GRAPH: ${this.decodeBuffer(buffer.graphRefs)}`);
    }

    if (buffer.policyRefs.length > 0) {
      sections.push(`POLICIES: ${this.decodeBuffer(buffer.policyRefs)}`);
    }

    if (buffer.toolRefs.length > 0) {
      sections.push(`TOOLS: ${this.decodeBuffer(buffer.toolRefs)}`);
    }

    return sections.join('\n\n');
  }

  private decodeBuffer(buffer: Uint32Array): string {
    return new TextDecoder().decode(new Uint8Array(buffer.buffer));
  }

  async switchModel(modelId: string): Promise<void> {
    const config = this.modelRegistry.get(modelId);
    if (!config) {
      throw new Error(`Model ${modelId} not registered`);
    }

    if (this.currentModel?.modelId === modelId) return;

    if (this.engine) {
      await this.engine.unload();
    }

    await this.loadModel(config);
  }

  getCurrentModel(): ModelConfig | null {
    return this.currentModel;
  }

  isReady(): boolean {
    return this.engine !== null;
  }
}

export const webllmRuntime = new WebLLMRuntime();