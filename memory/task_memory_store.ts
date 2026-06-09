import { TaskMemoryStore } from "../shared/types";
import { createHash } from "crypto";

export interface VectorRecord {
  key: string;
  text: string;
  embedding: number[];
  metadata: Record<string, unknown>;
}

export interface VectorBackend {
  upsert(record: VectorRecord): Promise<void>;
  search(embedding: number[], limit: number): Promise<VectorRecord[]>;
}

function localEmbed(text: string, dimensions = 16): number[] {
  const buckets = new Array(dimensions).fill(0);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    buckets[i % dimensions] += (code % 31) / 31;
    buckets[(i * 7) % dimensions] += ((code % 17) - 8) / 17;
  }
  const norm = Math.sqrt(buckets.reduce((acc, v) => acc + v * v, 0)) || 1;
  return buckets.map((v) => v / norm);
}

function cosine(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / ((Math.sqrt(magA) || 1) * (Math.sqrt(magB) || 1));
}

export class LocalVectorBackend implements VectorBackend {
  private records = new Map<string, VectorRecord>();

  async upsert(record: VectorRecord): Promise<void> {
    this.records.set(record.key, record);
  }

  async search(embedding: number[], limit: number): Promise<VectorRecord[]> {
    return [...this.records.values()]
      .map((record) => ({ record, score: cosine(embedding, record.embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((entry) => entry.record);
  }
}

export class HttpVectorBackend implements VectorBackend {
  constructor(private readonly endpoint: string) {}

  async upsert(record: VectorRecord): Promise<void> {
    await fetch(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "upsert", record }),
    });
  }

  async search(embedding: number[], limit: number): Promise<VectorRecord[]> {
    const resp = await fetch(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "search", embedding, limit }),
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    return Array.isArray(data.records) ? data.records as VectorRecord[] : [];
  }
}

export class GriptapeTaskMemory implements TaskMemoryStore {
  private store = new Map<string, unknown>();
  private buffer: Record<string, unknown>[] = [];
  private vectors: VectorBackend;

  constructor(vectorBackend?: VectorBackend) {
    this.vectors = vectorBackend ?? new LocalVectorBackend();
  }

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

  async putVector(key: string, text: string, metadata: Record<string, unknown> = {}): Promise<void> {
    const embedding = localEmbed(text);
    await this.vectors.upsert({ key, text, embedding, metadata });
    await this.set(key, { text, embedding, metadata });
  }

  async searchVector(query: string, limit = 5): Promise<VectorRecord[]> {
    return this.vectors.search(localEmbed(query), limit);
  }
}
