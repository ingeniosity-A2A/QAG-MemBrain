// ═══════════════════════════════════════════════════════════════════
// QAG_MemBrain — Vector Quantization Layer
//
// Achieves 75–97% reduction in vector size per the white paper spec.
// Smaller vectors → more in hot cache → less fetch latency.
//
// Three modes:
//   float32 — full precision (default, 1536 dims × 4 bytes = 6,144 bytes)
//   int8    — mandatory minimum (75% reduction → 1,536 bytes)
//   binary  — 1-bit (97% reduction → 192 bytes, lossy)
//
// Neo4j vector index uses float32 natively.
// Quantized vectors are stored as a secondary property for fast pre-filter.
// Final re-ranking uses float32 for precision after binary candidate retrieval.
// ═══════════════════════════════════════════════════════════════════

export type QuantizationMode = "float32" | "int8" | "binary";

export interface QuantizationConfig {
  mode:            QuantizationMode;
  dimensions:      number;         // 1536 for OpenAI-compatible embeddings
  rerank_with_f32: boolean;        // After binary candidate retrieval, re-rank with float32
}

export const QUANTIZATION_PRESETS: Record<string, QuantizationConfig> = {
  // Full precision — use for cortex-level recall where fidelity is critical
  full: { mode: "float32", dimensions: 1536, rerank_with_f32: false },
  // Int8 — mandatory minimum per white paper. 75% size reduction.
  // Preserves semantic proximity with minimal quality loss.
  int8: { mode: "int8", dimensions: 1536, rerank_with_f32: false },
  // Binary — 97% reduction. Use for initial candidate filtering only.
  // Always re-rank top-k with float32 before returning results.
  binary: { mode: "binary", dimensions: 1536, rerank_with_f32: true },
};

// ─── Float32 → Int8 quantization ─────────────────────────────────────
// Maps each float in [-1, 1] to a signed 8-bit integer [-127, 127]
export function quantizeToInt8(vector: number[]): Int8Array {
  const result = new Int8Array(vector.length);
  for (let i = 0; i < vector.length; i++) {
    // Clamp to [-1, 1] then scale
    const clamped = Math.max(-1, Math.min(1, vector[i]));
    result[i] = Math.round(clamped * 127);
  }
  return result;
}

// ─── Float32 → Binary quantization ──────────────────────────────────
// 1-bit: sign of each component. 1536 floats → 192 bytes (packed bits)
// This is the "1-bit" representation — positive=1, negative=0
export function quantizeToBinary(vector: number[]): Uint8Array {
  const bytes = Math.ceil(vector.length / 8);
  const result = new Uint8Array(bytes);
  for (let i = 0; i < vector.length; i++) {
    if (vector[i] > 0) {
      result[Math.floor(i / 8)] |= (1 << (i % 8));
    }
  }
  return result;
}

// ─── Hamming distance for binary vector similarity ────────────────────
// Fast bitwise comparison — CPU-cache friendly
export function hammingDistance(a: Uint8Array, b: Uint8Array): number {
  let dist = 0;
  for (let i = 0; i < a.length; i++) {
    let xor = a[i] ^ b[i];
    while (xor) { dist += xor & 1; xor >>= 1; }
  }
  return dist;
}

// ─── Int8 dot product (approximate cosine similarity) ────────────────
export function int8DotProduct(a: Int8Array, b: Int8Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum / (127 * 127 * a.length); // Normalize to [-1, 1]
}

// ─── Quantized atom: stores both full + compressed for two-stage retrieval ──
// Stage 1: binary candidate retrieval (fast, approximate)
// Stage 2: float32 re-ranking of top candidates (precise)
export interface QuantizedAtomEmbedding {
  atom_id:    string;
  float32:    number[];       // Full precision — for final re-rank
  int8?:      number[];       // Int8 compressed — 75% smaller
  binary?:    number[];       // Binary packed — 97% smaller, use for pre-filter
  mode:       QuantizationMode;
}

export function prepareQuantizedEmbedding(
  atom_id: string,
  vector:  number[],
  config:  QuantizationConfig
): QuantizedAtomEmbedding {
  const base: QuantizedAtomEmbedding = { atom_id, float32: vector, mode: config.mode };

  switch (config.mode) {
    case "int8":
      return { ...base, int8: Array.from(quantizeToInt8(vector)) };
    case "binary":
      return { ...base, binary: Array.from(quantizeToBinary(vector)) };
    default:
      return base;
  }
}

// ─── Neo4j schema additions for quantized indexes ────────────────────
// Append to SCHEMA_CYPHER in neo4j_graph.ts
export const QUANTIZED_SCHEMA_CYPHER = `
// Int8 compressed embedding index (75% smaller than float32)
CREATE VECTOR INDEX memory_embedding_int8 IF NOT EXISTS
  FOR (m:Memory) ON (m.embedding_int8)
  OPTIONS { indexConfig: {
    'vector.dimensions': 1536,
    'vector.similarity_function': 'cosine'
  }};

// Binary embedding stored as integer array for Hamming pre-filter
CREATE INDEX memory_embedding_binary IF NOT EXISTS
  FOR (m:Memory) ON (m.embedding_binary);
`;

// ─── Two-stage retrieval query ────────────────────────────────────────
// Stage 1: fast binary candidate retrieval (large k)
// Stage 2: float32 re-ranking of candidates (small final k)
export function buildTwoStageQuery(candidateK: number = 50, finalK: number = 10): string {
  return `
// Stage 1: Binary pre-filter using Hamming distance (approximation)
MATCH (m:Memory)
WHERE m.embedding_binary IS NOT NULL
WITH m, gds.similarity.hamming(m.embedding_binary, $binaryQuery) AS hamming_dist
ORDER BY hamming_dist ASC LIMIT ${candidateK}

// Stage 2: Re-rank candidates with full float32 precision
WITH m
CALL db.index.vector.queryNodes('memory_embedding', ${finalK}, $float32Query)
YIELD node AS ranked, score
WHERE ranked.id = m.id

// GQL SIMPLE restrictor — no join bombs on graph expansion
OPTIONAL MATCH path = (anchor:Memory { id: $anchorId })-[:PRECEDES*1..3 SIMPLE]->(ranked)
RETURN ranked {
  .id, .type, .content, .importance, .confidence, .embedding
} AS atom, score
ORDER BY score DESC LIMIT ${finalK}
  `.trim();
}
