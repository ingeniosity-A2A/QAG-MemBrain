export interface ExecutiveRuntime {
  plan(goal: string, context: Record<string, unknown>): Promise<string[]>;
  orchestrate(planSteps: string[]): Promise<void>;
}
