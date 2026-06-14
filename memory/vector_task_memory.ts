import Database from "better-sqlite3";
import { pipeline } from "@xenova/transformers";
import sqliteVec from "sqlite-vec";
import { TaskMemoryStore } from "../shared/types";

export interface VectorRecord {
  id: string;
  key: string;
  text: string;
  embedding: number[];
  metadata: Record<string, unknown>;
}

export interface VectorSearchResult {
  key: string;
  text: string;
  embedding: number[];
  metadata: Record<string, unknown>;
  distance: number;
}

type Embedder = Awaited<ReturnType<typeof pipeline>>;

export class VectorTaskMemory implements TaskMemoryStore {
  private readonly db: Database.Database;
  private readonly kv = new Map<string, unknown>();
  private embedder: Embedder | null = null;

  constructor(private dbPath = "./data/task_memory.db") {
    this.db = new Database(dbPath);
    sqliteVec.load(this.db);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        ttl INTEGER
      );
      CREATE TABLE IF NOT EXISTS memory_vectors (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL,
        text TEXT NOT NULL,
        embedding TEXT NOT NULL,
        metadata TEXT NOT NULL
      );
    `);
  }

  private async initEmbedder(): Promise<Embedder> {
    if (!this.embedder) {
      this.embedder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
    }
    return this.embedder;
  }

  private async getEmbedding(text: string): Promise<number[]> {
    const embedder = await this.initEmbedder();
    const output = await (embedder as any)(text, { pooling: "mean", normalize: true, normalizeEmbeddings: true });
    return Array.from((output as any).data as Float32Array);
  }

  async get(key: string): Promise<unknown | null> {
    const cached = this.kv.get(key);
    if (cached !== undefined) return cached;
    const row = this.db.prepare(
      `SELECT value, ttl FROM kv WHERE key = ?`,
    ).get(key) as { value: string; ttl: number | null } | undefined;
    if (!row) return null;
    if (row.ttl !== null && row.ttl <= Date.now()) {
      this.db.prepare(`DELETE FROM kv WHERE key = ?`).run(key);
      return null;
    }
    const parsed = JSON.parse(row.value);
    this.kv.set(key, parsed);
    return parsed;
  }

  async set(key: string, value: unknown, ttlMs?: number): Promise<void> {
    this.kv.set(key, value);
    this.db.prepare(
      `INSERT OR REPLACE INTO kv (key, value, ttl) VALUES (?, ?, ?)`,
    ).run(key, JSON.stringify(value), ttlMs ? Date.now() + ttlMs : null);
  }

  async delete(key: string): Promise<void> {
    this.kv.delete(key);
    this.db.prepare(`DELETE FROM kv WHERE key = ?`).run(key);
    this.db.prepare(`DELETE FROM memory_vectors WHERE key = ?`).run(key);
  }

  async bufferSignal(signal: Record<string, unknown>): Promise<void> {
    const text = JSON.stringify(signal);
    const embedding = await this.getEmbedding(text);
    const id = `sig_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    this.db.prepare(
      `INSERT OR REPLACE INTO memory_vectors (id, key, text, embedding, metadata) VALUES (?, ?, ?, ?, ?)`,
    ).run(id, id, text, JSON.stringify(embedding), JSON.stringify(signal));
    await this.set(id, signal, 60 * 60 * 1000);
  }

  async flush(): Promise<Record<string, unknown>[]> {
    const rows = this.db.prepare(`SELECT key FROM kv ORDER BY key ASC`).all() as Array<{ key: string }>;
    const result: Record<string, unknown>[] = [];
    for (const row of rows) {
      const value = await this.get(row.key);
      if (value && typeof value === "object") result.push(value as Record<string, unknown>);
    }
    return result;
  }

  async putVector(key: string, text: string, metadata: Record<string, unknown> = {}): Promise<void> {
    const embedding = await this.getEmbedding(text);
    const id = `vec_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    this.db.prepare(
      `INSERT OR REPLACE INTO memory_vectors (id, key, text, embedding, metadata) VALUES (?, ?, ?, ?, ?)`,
    ).run(id, key, text, JSON.stringify(embedding), JSON.stringify(metadata));
    await this.set(key, { text, embedding, metadata });
  }

  async semanticSearch(query: string, limit = 5): Promise<VectorSearchResult[]> {
    const queryEmbedding = await this.getEmbedding(query);
    const rows = this.db.prepare(`SELECT key, text, embedding, metadata FROM memory_vectors`).all() as Array<{
      key: string;
      text: string;
      embedding: string;
      metadata: string;
    }>;
    const scored = rows.map((row) => {
      const embedding = JSON.parse(row.embedding) as number[];
      const distance = this.cosineDistance(queryEmbedding, embedding);
      return {
        key: row.key,
        text: row.text,
        embedding,
        metadata: JSON.parse(row.metadata) as Record<string, unknown>,
        distance,
      };
    });
    return scored.sort((a, b) => a.distance - b.distance).slice(0, limit);
  }

  private cosineDistance(a: number[], b: number[]): number {
    const len = Math.min(a.length, b.length);
    let dot = 0;
    let magA = 0;
    let magB = 0;
    for (let i = 0; i < len; i++) {
      dot += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }
    const sim = dot / ((Math.sqrt(magA) || 1) * (Math.sqrt(magB) || 1));
    return 1 - sim;
  }
}
