export interface VectorMatch {
  id: string;
  score: number;
}

export interface Neo4jVectorIndex {
  upsertEmbedding(nodeId: string, embedding: number[]): Promise<void>;
  similaritySearch(embedding: number[], topK: number): Promise<VectorMatch[]>;
}

export class InMemoryVectorIndex implements Neo4jVectorIndex {
  private readonly vectors = new Map<string, number[]>();

  async upsertEmbedding(nodeId: string, embedding: number[]): Promise<void> {
    this.vectors.set(nodeId, embedding);
  }

  async similaritySearch(embedding: number[], topK: number): Promise<VectorMatch[]> {
    const matches: VectorMatch[] = [];

    for (const [id, vector] of this.vectors) {
      const score = cosineSimilarity(embedding, vector);
      matches.push({ id, score });
    }

    return matches.sort((a, b) => b.score - a.score).slice(0, topK);
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  const size = Math.min(a.length, b.length);
  if (size === 0) {
    return 0;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < size; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
