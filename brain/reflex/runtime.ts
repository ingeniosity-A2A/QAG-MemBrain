export interface ReflexRuntime {
  route(eventType: string, payload: unknown): Promise<string>;
  handleEvent(eventType: string, payload: unknown): Promise<void>;
}

export type ReflexHandler = (payload: unknown) => Promise<void> | void;

export class BasicReflexRuntime implements ReflexRuntime {
  private readonly handlers = new Map<string, ReflexHandler>();

  async route(eventType: string, payload: unknown): Promise<string> {
    const candidate = payload as { memoryId?: unknown } | null;
    const hasMemoryId =
      typeof candidate === "object" &&
      candidate !== null &&
      typeof candidate.memoryId === "string" &&
      candidate.memoryId.length > 0;

    if (eventType === "decision_input" || hasMemoryId) {
      return "executive:plan";
    }

    return "reflex:ignore";
  }

  async handleEvent(eventType: string, payload: unknown): Promise<void> {
    const handler = this.handlers.get(eventType);
    if (!handler) {
      return;
    }

    await handler(payload);
  }

  on(eventType: string, handler: ReflexHandler): void {
    this.handlers.set(eventType, handler);
  }
}
