/**
 * L1 – Ingestion Pipeline
 * High-fidelity transcription and recursive semantic chunking.
 * Populates the Subconscious Context Lake with InteractionQuanta.
 *
 * Dependencies: No external imports from broken root-level modules.
 * Uses inline types compatible with the canonical MemoryStore.
 */
import { MemoryStore, type MemoryEntry } from '../jsonl/index.js';

// ─── Inline types ────────────────────────────────────────────────────

export interface SemanticChunk {
  text: string;
  timestamp_start: string;
  timestamp_end: string;
}

export interface TranscriptionResult {
  text: string;
  chunks: SemanticChunk[];
}

export interface ChunkingOptions {
  size: number;
  overlap: number;
  separators: string[];
}

export interface IngestionMetadata {
  source_url: string;
  primary_theme: string;
  lexicon_tags: string[];
  [key: string]: unknown;
}

// ─── Recursive Semantic Chunking ─────────────────────────────────────

/**
 * Splits text into overlapping chunks of target size.
 * Prioritizes separator boundaries (oratorical pauses, paragraphs, sentences).
 */
export function performRecursiveChunking(
  text: string,
  options: ChunkingOptions = { size: 1000, overlap: 150, separators: ['\n\n', '\n', '.', ' ', ''] },
): string[] {
  const { size, overlap, separators } = options;
  if (text.length <= size) return [text];

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + size, text.length);

    // Try to find a natural break point within the window
    if (end < text.length) {
      let bestBreak = -1;
      for (const sep of separators) {
        const idx = text.lastIndexOf(sep, end);
        if (idx > start && idx > bestBreak) {
          bestBreak = idx + sep.length;
        }
      }
      if (bestBreak > start) end = bestBreak;
    }

    chunks.push(text.slice(start, end));
    start = end - overlap;
    if (start >= text.length) break;
    if (start < 0) start = 0;
  }

  return chunks;
}

// ─── Full Whisper Transcription (stub) ───────────────────────────────

/**
 * Transcribes audio with word-level timestamps.
 * Production: calls local Whisper or API with word_timestamps=True.
 * Stub: returns placeholder for testing.
 */
export async function runFullWhisperTranscription(
  _audioPath: string,
  sourceUrl: string,
): Promise<TranscriptionResult> {
  // Stub transcription — replace with actual Whisper integration
  const result: TranscriptionResult = {
    text: '[Transcription placeholder — integrate Whisper API or local model]',
    chunks: [],
  };

  return result;
}

// ─── Ingestion Pipeline ──────────────────────────────────────────────

export class IngestionPipeline {
  private store: MemoryStore;

  constructor(store: MemoryStore) {
    this.store = store;
  }

  /**
   * Ingest a transcribed source: chunk it and persist each chunk as a
   * memory atom on L1 (JSONL append-only).
   */
  async ingestTranscription(
    transcription: TranscriptionResult,
    metadata: IngestionMetadata,
  ): Promise<MemoryEntry[]> {
    const chunks = performRecursiveChunking(transcription.text, {
      size: 1000,
      overlap: 150,
      separators: ['\n\n', '\n', '.', ' ', ''],
    });

    const entries: MemoryEntry[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const entry = this.store.append(1, 'ingestion', {
        chunk_index: i,
        total_chunks: chunks.length,
        content: chunks[i],
        source_url: metadata.source_url,
        primary_theme: metadata.primary_theme,
        lexicon_tags: metadata.lexicon_tags,
        timestamp_range: transcription.chunks[i]
          ? { start: transcription.chunks[i].timestamp_start, end: transcription.chunks[i].timestamp_end }
          : null,
      });
      entries.push(entry);
    }

    return entries;
  }

  /**
   * Convenience: transcribe and ingest in one call.
   */
  async transcribeAndIngest(
    audioPath: string,
    metadata: IngestionMetadata,
  ): Promise<MemoryEntry[]> {
    const transcription = await runFullWhisperTranscription(audioPath, metadata.source_url);
    return this.ingestTranscription(transcription, metadata);
  }
}
