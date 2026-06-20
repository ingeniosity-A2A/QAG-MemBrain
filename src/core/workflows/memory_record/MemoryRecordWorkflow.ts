import { GovernanceContract } from '@runtime/governance/GovernanceContract.js';
import { ContextAssembler } from '@runtime/governance/ContextAssembler.js';
import { vibeThinkerProvider } from '@core/inference/webllm/VibeThinkerProvider.js';
import { ContextBuffer } from '@core/inference/webllm/Runtime.js';

export interface JobOutcome {
  bookingId: string;
  technicianId: string;
  customerId: string;
  startTime: number;
  endTime: number;
  status: 'completed' | 'cancelled' | 'partial';
  photos?: Uint8Array[];
  notes?: string;
  actualHours: number;
  actualCost: number;
  customerRating?: number;
}

export interface MemoryRecord {
  id: string;
  jobId: string;
  type: 'job_completion' | 'customer_interaction' | 'technician_performance' | 'product_knowledge';
  summary: string;
  entities: MemoryEntity[];
  insights: string[];
  confidence: number;
  tags: string[];
  createdAt: number;
}

export interface MemoryEntity {
  id: string;
  type: 'customer' | 'technician' | 'product' | 'location' | 'tool';
  name: string;
  attributes: Record<string, unknown>;
}

export class MemoryRecordWorkflow {
  private governance: GovernanceContract;
  private contextAssembler: ContextAssembler;

  constructor(governance: GovernanceContract, contextAssembler: ContextAssembler) {
    this.governance = governance;
    this.contextAssembler = contextAssembler;
  }

  async execute(outcome: JobOutcome): Promise<MemoryRecord[]> {
    const records: MemoryRecord[] = [];

    const completionRecord = await this.createCompletionRecord(outcome);
    records.push(completionRecord);

    if (outcome.customerRating !== undefined) {
      const ratingRecord = await this.createRatingRecord(outcome);
      records.push(ratingRecord);
    }

    if (outcome.photos && outcome.photos.length > 0) {
      const photoRecords = await this.createPhotoRecords(outcome);
      records.push(...photoRecords);
    }

    return records;
  }

  private async createCompletionRecord(outcome: JobOutcome): Promise<MemoryRecord> {
    const contextBuffer = this.buildMemoryContext(outcome, 'completion');
    
    const prompt = `Create a structured memory record for this completed job:
Job: ${outcome.bookingId}
Technician: ${outcome.technicianId}
Customer: ${outcome.customerId}
Duration: ${outcome.actualHours} hours (estimated: ${outcome.actualHours})
Cost: $${outcome.actualCost}
Status: ${outcome.status}
Notes: ${outcome.notes ?? 'None'}

Extract:
1. Concise summary
2. Key entities (customer, technician, product, location, tools)
3. Actionable insights for future jobs
4. Tags for categorization

Return as JSON`;

    const response = await vibeThinkerProvider.inferWithFallback(contextBuffer, {
      temperature: 0.2,
      maxTokens: 1024,
    });

    const data = JSON.parse(response.text);

    return {
      id: crypto.randomUUID(),
      jobId: outcome.bookingId,
      type: 'job_completion',
      summary: data.summary,
      entities: data.entities,
      insights: data.insights,
      confidence: data.confidence ?? 0.8,
      tags: data.tags ?? ['completion', 'job'],
      createdAt: Date.now(),
    };
  }

  private async createRatingRecord(outcome: JobOutcome): Promise<MemoryRecord> {
    return {
      id: crypto.randomUUID(),
      jobId: outcome.bookingId,
      type: 'customer_interaction',
      summary: `Customer rated job ${outcome.customerRating}/5`,
      entities: [
        { id: outcome.customerId, type: 'customer', name: 'Customer', attributes: { rating: outcome.customerRating } },
      ],
      insights: outcome.customerRating >= 4 
        ? ['Customer satisfied, replicate approach'] 
        : ['Customer dissatisfied, review process'],
      confidence: 1.0,
      tags: ['rating', 'customer_feedback'],
      createdAt: Date.now(),
    };
  }

  private async createPhotoRecords(outcome: JobOutcome): Promise<MemoryRecord[]> {
    return outcome.photos!.map((photo, index) => ({
      id: crypto.randomUUID(),
      jobId: outcome.bookingId,
      type: 'product_knowledge' as const,
      summary: `Job completion photo ${index + 1}`,
      entities: [
        { id: outcome.bookingId, type: 'job' as const, name: 'Job', attributes: { photoIndex: index } },
      ],
      insights: ['Visual reference for similar jobs'],
      confidence: 0.9,
      tags: ['photo', 'visual_reference'],
      createdAt: Date.now(),
    }));
  }

  private buildMemoryContext(outcome: JobOutcome, type: string): ContextBuffer {
    return {
      objective: new TextEncoder().encode(`Create ${type} memory record`).buffer as unknown as Uint32Array,
      memoryRefs: new Uint32Array(0),
      graphRefs: new Uint32Array(0),
      policyRefs: new Uint32Array(0),
      toolRefs: new Uint32Array(0),
    };
  }
}

export const memoryRecordWorkflow = new MemoryRecordWorkflow(
  new GovernanceContract(),
  new ContextAssembler({ maxTokens: 32000, reserved: 4000, priorityOrder: ['objective', 'memory', 'graph', 'tools', 'policies'] })
);