export interface VectorRecord {
  key: string;
  text: string;
  embedding: number[];
  metadata: Record<string, unknown>;
}

function embed(text: string): number[] {
  const values = new Array<number>(16).fill(0);
  for (let i = 0; i < text.length; i += 1) {
    values[i % values.length] += text.charCodeAt(i) / 255;
  }
  return values;
}

function cosineDistance(a: number[], b: number[]): number {
  const size = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < size; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 1;
  return 1 - dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export class VectorTaskMemory {
  private readonly records = new Map<string, VectorRecord>();

  async putVector(key: string, text: string, metadata: Record<string, unknown> = {}): Promise<void> {
    this.records.set(key, { key, text, metadata, embedding: embed(text) });
  }

  async semanticSearch(query: string, limit = 5): Promise<VectorRecord[]> {
    const queryEmbedding = embed(query);
    return [...this.records.values()]
      .map((record) => ({ record, distance: cosineDistance(queryEmbedding, record.embedding) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, limit)
      .map(({ record }) => record);
  }
}
