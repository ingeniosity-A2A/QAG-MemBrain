export interface CortexRuntime {
  learn(signal: Record<string, unknown>): Promise<void>;
  adaptPolicy(policyId: string, update: Record<string, unknown>): Promise<void>;
}
