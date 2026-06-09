import { TaskMemoryStore } from "../shared/types.js";

export class GriptapeTaskMemory implements TaskMemoryStore {
  private store = new Map<string, unknown>();
  private buffer: Record<string, unknown>[] = [];

  async get(key: string): Promise<unknown | null> {
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: unknown, ttlMs?: number): Promise<void> {
    this.store.set(key, value);
    if (ttlMs) {
      setTimeout(() => this.store.delete(key), ttlMs);
    }
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async bufferSignal(signal: Record<string, unknown>): Promise<void> {
    this.buffer.push(signal);
    if (this.buffer.length > 1000) this.buffer.shift();
  }

  async flush(): Promise<Record<string, unknown>[]> {
    const copy = [...this.buffer];
    this.buffer = [];
    return copy;
  }
}
