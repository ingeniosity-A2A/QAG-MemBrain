import { ModelConfig } from './Runtime.js';

export const MODEL_REGISTRY: Record<string, ModelConfig> = {
  vibethinker: {
    modelId: 'vibethinker-3b',
    contextWindow: 32768,
    preferred: true,
  },
  gemma: {
    modelId: 'gemma-2-2b-it-q4f16_1',
    contextWindow: 8192,
    fallback: true,
  },
  gemma4b: {
    modelId: 'gemma-2-4b-it-q4f16_1',
    contextWindow: 8192,
    fallback: true,
  },
};

export function getPreferredModel(): ModelConfig {
  for (const config of Object.values(MODEL_REGISTRY)) {
    if (config.preferred) return config;
  }
  return MODEL_REGISTRY.vibethinker;
}

export function getFallbackModel(): ModelConfig {
  for (const config of Object.values(MODEL_REGISTRY)) {
    if (config.fallback) return config;
  }
  return MODEL_REGISTRY.gemma;
}

export function getModelById(modelId: string): ModelConfig | undefined {
  return Object.values(MODEL_REGISTRY).find(m => m.modelId === modelId);
}