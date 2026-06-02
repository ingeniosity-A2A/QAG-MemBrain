export interface ReflexRuntime {
  route(eventType: string, payload: unknown): Promise<string>;
  handleEvent(eventType: string, payload: unknown): Promise<void>;
}
