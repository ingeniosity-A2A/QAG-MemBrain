import { GovernanceContract, GovernanceContext } from '../../runtime/governance/GovernanceContract.js';
import { ContextAssembler } from '../../runtime/governance/ContextAssembler.js';
import { vibeThinkerProvider } from '../../inference/webllm/VibeThinkerProvider.js';
import { webllmRuntime, ContextBuffer } from '../../inference/webllm/Runtime.js';

export interface PhotoInput {
  imageData: Uint8Array;
  mimeType: string;
  customerId: string;
  location: { lat: number; lng: number };
  timestamp: number;
}

export interface ProductDetection {
  productType: string;
  brand?: string;
  model?: string;
  condition: 'new' | 'used' | 'damaged';
  confidence: number;
  dimensions?: { width: number; height: number; depth: number };
  materials?: string[];
}

export interface Quote {
  id: string;
  customerId: string;
  productType: string;
  description: string;
  estimatedHours: number;
  estimatedCost: number;
  lineItems: QuoteLineItem[];
  validUntil: number;
  status: 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired';
  createdAt: number;
}

export interface QuoteLineItem {
  description: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
}

export class PhotoQuoteWorkflow {
  private governance: GovernanceContract;
  private contextAssembler: ContextAssembler;

  constructor(governance: GovernanceContract, contextAssembler: ContextAssembler) {
    this.governance = governance;
    this.contextAssembler = contextAssembler;
  }

  async execute(input: PhotoInput): Promise<Quote> {
    const detection = await this.detectProduct(input);
    const quote = await this.generateQuote(input, detection);
    return quote;
  }

  private async detectProduct(input: PhotoInput): Promise<ProductDetection> {
    const contextBuffer = this.buildDetectionContext(input);
    
    const prompt = `Analyze this product photo and identify:
1. Product type (furniture, appliance, electronics, etc.)
2. Brand (if visible)
3. Model (if visible)
4. Condition (new/used/damaged)
5. Approximate dimensions
6. Materials

Return as JSON with fields: productType, brand, model, condition, confidence, dimensions, materials`;

    const response = await vibeThinkerProvider.inferWithFallback(contextBuffer, {
      temperature: 0.1,
      maxTokens: 1024,
    });

    try {
      return JSON.parse(response.text) as ProductDetection;
    } catch {
      return {
        productType: 'unknown',
        condition: 'used',
        confidence: 0.1,
      };
    }
  }

  private async generateQuote(input: PhotoInput, detection: ProductDetection): Promise<Quote> {
    const contextBuffer = this.buildQuoteContext(input, detection);
    
    const prompt = `Generate a service quote for:
Product: ${detection.productType} ${detection.brand ?? ''} ${detection.model ?? ''}
Condition: ${detection.condition}
Location: ${input.location.lat}, ${input.location.lng}

Include:
1. Estimated labor hours
2. Material costs
3. Travel costs
4. Total estimate
5. Line items breakdown

Return as JSON with: estimatedHours, estimatedCost, lineItems`;

    const response = await vibeThinkerProvider.inferWithFallback(contextBuffer, {
      temperature: 0.2,
      maxTokens: 1536,
    });

    const quoteData = JSON.parse(response.text);
    
    return {
      id: crypto.randomUUID(),
      customerId: input.customerId,
      productType: detection.productType,
      description: `${detection.brand ?? ''} ${detection.model ?? ''} ${detection.productType}`.trim(),
      estimatedHours: quoteData.estimatedHours,
      estimatedCost: quoteData.estimatedCost,
      lineItems: quoteData.lineItems,
      validUntil: Date.now() + 7 * 24 * 60 * 60 * 1000,
      status: 'draft',
      createdAt: Date.now(),
    };
  }

  private buildDetectionContext(input: PhotoInput): ContextBuffer {
    return {
      objective: new TextEncoder().encode('Detect product from photo').buffer as unknown as Uint32Array,
      memoryRefs: new Uint32Array(0),
      graphRefs: new Uint32Array(0),
      policyRefs: new Uint32Array(0),
      toolRefs: new Uint32Array(0),
    };
  }

  private buildQuoteContext(input: PhotoInput, detection: ProductDetection): ContextBuffer {
    const contextData = {
      detection,
      location: input.location,
      customerId: input.customerId,
    };
    
    return {
      objective: new TextEncoder().encode(JSON.stringify(contextData)).buffer as unknown as Uint32Array,
      memoryRefs: new Uint32Array(0),
      graphRefs: new Uint32Array(0),
      policyRefs: new Uint32Array(0),
      toolRefs: new Uint32Array(0),
    };
  }
}

export const photoQuoteWorkflow = new PhotoQuoteWorkflow(
  new GovernanceContract(),
  new ContextAssembler({ maxTokens: 32000, reserved: 4000, priorityOrder: ['objective', 'memory', 'graph', 'tools', 'policies'] })
);