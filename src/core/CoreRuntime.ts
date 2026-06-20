import { GovernanceContract, GovernanceContext } from '@runtime/governance/GovernanceContract.js';
import { ContextAssembler } from '@runtime/governance/ContextAssembler.js';
import { AgentStop } from '@runtime/governance/AgentStop.js';
import { BoundaryEnforcer } from '@runtime/governance/BoundaryEnforcer.js';
import { HeadroomManager } from '@runtime/governance/HeadroomManager.js';
import { photoQuoteWorkflow, PhotoInput, Quote } from './workflows/photo_quote/PhotoQuoteWorkflow.js';
import { bookingWorkflow, SchedulingRequest, Booking } from './workflows/booking/BookingWorkflow.js';
import { memoryRecordWorkflow, JobOutcome } from './workflows/memory_record/MemoryRecordWorkflow.js';
import { vibeThinkerProvider } from './inference/webllm/VibeThinkerProvider.js';
import { webllmRuntime } from './inference/webllm/Runtime.js';
import { s25UltraNPU } from './hardware/s25ultra_npu.js';
import { sharedTensorManager } from './inference/zero_copy/SharedTensor.js';
import { arrowBuffer } from './inference/zero_copy/ArrowBuffer.js';

export interface RuntimeConfig {
  maxTokens: number;
  reserveTokens: number;
  authorityId: string;
  deviceId: string;
}

export class CoreRuntime {
  private config: RuntimeConfig;
  private governance: GovernanceContract;
  private contextAssembler: ContextAssembler;
  private agentStop: AgentStop;
  private boundaryEnforcer: BoundaryEnforcer;
  private headroomManager: HeadroomManager;
  private initialized = false;

  constructor(config: RuntimeConfig) {
    this.config = config;
    this.governance = new GovernanceContract();
    this.contextAssembler = new ContextAssembler({
      maxTokens: config.maxTokens,
      objective: '',
      priorityOrder: ['objective', 'memory', 'graph', 'tools', 'policies'],
    });
    this.agentStop = new AgentStop(this.governance);
    this.boundaryEnforcer = new BoundaryEnforcer({
      activeAuthority: config.authorityId,
      delegationChain: [],
      permissions: ['*'],
      restrictions: [],
    });
    this.headroomManager = new HeadroomManager({
      maxTokens: config.maxTokens,
      reserveTokens: config.reserveTokens,
      minContextTokens: 4000,
      compressionThreshold: 0.85,
    });
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    await vibeThinkerProvider.initialize();
    await s25UltraNPU.initialize();
    
    this.initialized = true;
    console.log('[CoreRuntime] Initialized successfully');
  }

  async processPhotoToBooking(input: PhotoInput): Promise<{ quote: Quote; booking: Booking; memories: any[] }> {
    this.assertInitialized();

    const quote = await photoQuoteWorkflow.execute(input);
    quote.status = 'accepted';

    const booking = await bookingWorkflow.execute({
      quoteId: quote.id,
      address: `Location: ${input.location.lat}, ${input.location.lng}`,
      customerId: input.customerId,
    }, quote);

    const outcome: JobOutcome = {
      bookingId: booking.id,
      technicianId: booking.technicianId,
      customerId: input.customerId,
      startTime: booking.scheduledStart,
      endTime: booking.scheduledEnd,
      status: 'completed',
      actualHours: quote.estimatedHours,
      actualCost: quote.estimatedCost,
    };

    const memories = await memoryRecordWorkflow.execute(outcome);

    return { quote, booking, memories };
  }

  async evaluateGovernance(context: GovernanceContext) {
    return this.governance.evaluate(context);
  }

  async interceptAgent(agentOutput: any, context: GovernanceContext) {
    return this.agentStop.intercept(agentOutput, context);
  }

  async checkBoundary(request: any) {
    return this.boundaryEnforcer.evaluate(request);
  }

  getHeadroomManager(): HeadroomManager {
    return this.headroomManager;
  }

  getContextAssembler(): ContextAssembler {
    return this.contextAssembler;
  }

  getGovernance(): GovernanceContract {
    return this.governance;
  }

  isReady(): boolean {
    return this.initialized && vibeThinkerProvider.isReady();
  }

  getInferenceProvider() {
    return vibeThinkerProvider;
  }

  getNPUBridge() {
    return s25UltraNPU;
  }

  getSharedTensorManager() {
    return sharedTensorManager;
  }

  getArrowBuffer() {
    return arrowBuffer;
  }

  private assertInitialized(): void {
    if (!this.initialized) {
      throw new Error('CoreRuntime not initialized. Call initialize() first.');
    }
  }
}

export function createCoreRuntime(config: Partial<RuntimeConfig> = {}): CoreRuntime {
  return new CoreRuntime({
    maxTokens: 32000,
    reserveTokens: 4000,
    authorityId: 'ava007-authority-v1',
    deviceId: 's25-ultra-primary',
    ...config,
  });
}