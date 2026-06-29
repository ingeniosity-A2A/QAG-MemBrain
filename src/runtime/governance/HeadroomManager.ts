export interface TokenBudget {
  total: number;
  reserved: number;
  available: number;
  allocations: Map<string, number>;
}

export interface CompressionResult {
  compressed: boolean;
  originalTokens: number;
  compressedTokens: number;
  removedSections: string[];
  compressionRatio: number;
}

export interface HeadroomConfig {
  maxTokens: number;
  reserveTokens: number;
  minContextTokens: number;
  compressionThreshold: number;
}

export class HeadroomManager {
  private budget: TokenBudget;
  private config: HeadroomConfig;
  private compressionHistory: CompressionResult[] = [];

  constructor(config: HeadroomConfig) {
    this.config = config;
    this.budget = {
      total: config.maxTokens,
      reserved: config.reserveTokens,
      available: config.maxTokens - config.reserveTokens,
      allocations: new Map(),
    };
  }

  allocate(section: string, tokens: number): boolean {
    if (this.budget.available < tokens) {
      return false;
    }

    this.budget.allocations.set(section, tokens);
    this.budget.available -= tokens;
    return true;
  }

  release(section: string): number {
    const tokens = this.budget.allocations.get(section) || 0;
    this.budget.allocations.delete(section);
    this.budget.available += tokens;
    return tokens;
  }

  getAvailable(): number {
    return this.budget.available;
  }

  getUsed(): number {
    return this.budget.total - this.budget.reserved - this.budget.available;
  }

  checkHeadroom(required: number): boolean {
    return this.budget.available >= required;
  }

  needsCompression(): boolean {
    const usageRatio = this.getUsed() / (this.config.maxTokens - this.config.reserveTokens);
    return usageRatio >= this.config.compressionThreshold;
  }

  compress(
    context: Record<string, unknown>,
    priorityOrder: string[]
  ): { context: Record<string, unknown>; result: CompressionResult } {
    const originalTokens = this.estimateTokens(context);
    const removedSections: string[] = [];
    let compressedContext = { ...context };

    for (const section of priorityOrder) {
      if (this.getAvailable() >= this.config.minContextTokens) {
        break;
      }

      if (compressedContext[section]) {
        const sectionTokens = this.estimateTokens({ [section]: compressedContext[section] });
        delete compressedContext[section];
        this.budget.available += sectionTokens;
        removedSections.push(section);
      }
    }

    const compressedTokens = this.estimateTokens(compressedContext);
    const result: CompressionResult = {
      compressed: true,
      originalTokens,
      compressedTokens,
      removedSections,
      compressionRatio: compressedTokens / originalTokens,
    };

    this.compressionHistory.push(result);
    return { context: compressedContext, result };
  }

  getCompressionHistory(): CompressionResult[] {
    return [...this.compressionHistory];
  }

  reset(): void {
    this.budget.available = this.config.maxTokens - this.config.reserveTokens;
    this.budget.allocations.clear();
  }

  private estimateTokens(obj: unknown): number {
    const str = JSON.stringify(obj);
    return Math.ceil(str.length / 4);
  }

  getBudget(): TokenBudget {
    return {
      ...this.budget,
      allocations: new Map(this.budget.allocations),
    };
  }
}

export const createHeadroomManager = (config: Partial<HeadroomConfig> = {}): HeadroomManager => {
  const defaultConfig: HeadroomConfig = {
    maxTokens: 128000,
    reserveTokens: 8000,
    minContextTokens: 4000,
    compressionThreshold: 0.85,
    ...config,
  };
  return new HeadroomManager(defaultConfig);
};