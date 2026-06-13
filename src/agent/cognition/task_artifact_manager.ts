/**
 * TaskArtifactManager — Offloading strategy for Task Memory handoffs.
 *
 * Prevents "render thrashing" and memory leaks on constrained devices
 * (Samsung Galaxy S26 Ultra, foldables, DeX) by storing large data
 * payloads as local artifacts and passing only reference IDs + cognitive
 * summaries into the LLM context window.
 *
 * Handoff strategies by capability:
 *   - Scraped Content / SQL Payloads: Full result → local artifact file.
 *     Pass reference_id + 200-word cognitive summary to executive agent.
 *   - Neo4j Traversals: Graph data stays "off-prompt". Only contextual
 *     nodes retrieved; Cypher queries run against the custom driver.
 *   - Temporal Replay: Bypasses LLM entirely. LiteNotebookLM seeks
 *     exact GSAP timeline coordinates in the Context Lake.
 *   - Voice Synthesis: Audio buffers stored as artifacts for EdgeMeshBridge.
 *   - Atmospheric Render: Mutation triggers mapped to GSAP coordinates.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { MemoryStore } from '../../memory/jsonl/index.js';

// ─── Artifact Types ──────────────────────────────────────────────────

export type ArtifactKind =
  | 'scraped_content'     // WebScraper output
  | 'sql_result_set'      // SqlClient output (>10 rows)
  | 'neo4j_traversal'     // Graph traversal result
  | 'temporal_coordinates' // GSAP timeline coordinates
  | 'audio_buffer'        // TTS output
  | 'atmosphere_snapshot' // A2UI mutation triggers
  | 'json_blob'           // Generic structured data
  | 'file_content';       // FileManager output

export interface TaskArtifact {
  /** Unique artifact ID. */
  id: string;
  /** Kind of artifact. */
  kind: ArtifactKind;
  /** Storage location (file path or URI). */
  location: string;
  /** Size in bytes. */
  sizeBytes: number;
  /** When the artifact was created (ISO 8601). */
  createdAt: string;
  /** Cognitive summary for LLM context (max ~200 words). */
  cognitiveSummary: string;
  /** The task that produced this artifact. */
  sourceTaskId: string;
  /** Whether this artifact has been consumed/read. */
  consumed: boolean;
  /** Expiration time (ISO 8601). Artifacts can be garbage collected after this. */
  expiresAt?: string;
  /** SHA-256 hash of the artifact content for integrity verification. */
  contentHash: string;
}

// ─── Handoff Thresholds ──────────────────────────────────────────────

export interface HandoffThresholds {
  /** Maximum payload size in bytes before triggering handoff. Default: 4096. */
  maxInlinePayloadBytes: number;
  /** Maximum SQL result rows before offloading. Default: 10. */
  maxSqlInlineRows: number;
  /** Maximum cognitive summary length in characters. Default: 1200 (~200 words). */
  maxSummaryChars: number;
  /** Artifact TTL in seconds. Default: 3600 (1 hour). */
  artifactTtlSeconds: number;
  /** Whether to persist artifacts to disk. Default: true. */
  persistToDisk: boolean;
}

export const DEFAULT_HANDOFF_THRESHOLDS: HandoffThresholds = {
  maxInlinePayloadBytes: 4096,
  maxSqlInlineRows: 10,
  maxSummaryChars: 1200,
  artifactTtlSeconds: 3600,
  persistToDisk: true,
};

// ─── TaskArtifactManager ─────────────────────────────────────────────

export class TaskArtifactManager {
  private artifacts: Map<string, TaskArtifact> = new Map();
  private thresholds: HandoffThresholds;
  private artifactDir: string;

  constructor(
    private memory: MemoryStore,
    thresholds?: Partial<HandoffThresholds>,
    artifactDir?: string,
  ) {
    this.thresholds = { ...DEFAULT_HANDOFF_THRESHOLDS, ...thresholds };
    this.artifactDir = artifactDir ?? path.join(process.cwd(), 'data', 'artifacts');

    if (this.thresholds.persistToDisk) {
      fs.mkdirSync(this.artifactDir, { recursive: true });
    }
  }

  // ─── Core API ───────────────────────────────────────────────────────

  /**
   * Store a payload as a Task Memory artifact. Returns the artifact
   * reference containing ID + cognitive summary for the LLM context.
   */
  async storeArtifact(input: {
    payload: unknown;
    kind: ArtifactKind;
    taskId: string;
    summary?: string;
  }): Promise<TaskArtifact> {
    const id = `artifact_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    const serialized = JSON.stringify(input.payload, null, 2);
    const sizeBytes = Buffer.byteLength(serialized, 'utf8');
    const contentHash = crypto.createHash('sha256').update(serialized).digest('hex');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.thresholds.artifactTtlSeconds * 1000).toISOString();

    // Generate cognitive summary if not provided
    const cognitiveSummary = input.summary ?? this.generateCognitiveSummary(input.payload, input.kind);

    const location = this.thresholds.persistToDisk
      ? path.join(this.artifactDir, `${id}.json`)
      : `memory://artifacts/${id}`;

    const artifact: TaskArtifact = {
      id,
      kind: input.kind,
      location,
      sizeBytes,
      createdAt: now.toISOString(),
      cognitiveSummary,
      sourceTaskId: input.taskId,
      consumed: false,
      expiresAt,
      contentHash,
    };

    // Persist to disk if enabled
    if (this.thresholds.persistToDisk) {
      fs.writeFileSync(location, serialized, 'utf8');
    }

    // Register in memory
    this.artifacts.set(id, artifact);
    this.memory.append(6, 'artifact_stored', { id, kind: input.kind, sizeBytes, taskId: input.taskId });

    return artifact;
  }

  /**
   * Retrieve a stored artifact by ID.
   * Loads from disk if not in memory.
   */
  async retrieveArtifact(artifactId: string): Promise<{ artifact: TaskArtifact; content: unknown } | null> {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) return null;

    let content: unknown;
    if (this.thresholds.persistToDisk && fs.existsSync(artifact.location)) {
      const raw = fs.readFileSync(artifact.location, 'utf8');
      content = JSON.parse(raw);
    } else {
      content = null;
    }

    // Mark as consumed
    artifact.consumed = true;

    return { artifact, content };
  }

  /**
   * Check if a payload exceeds the inline threshold and requires handoff.
   */
  isPayloadTooLarge(payload: unknown): boolean {
    const serialized = JSON.stringify(payload);
    const sizeBytes = Buffer.byteLength(serialized, 'utf8');
    return sizeBytes > this.thresholds.maxInlinePayloadBytes;
  }

  /**
   * Check if a SQL result set exceeds the inline row threshold.
   */
  isSqlResultTooLarge(rows: unknown[]): boolean {
    return rows.length > this.thresholds.maxSqlInlineRows;
  }

  /**
   * Perform the handoff: store the payload and return a reference
   * with cognitive summary suitable for the LLM context window.
   */
  async handoff(input: {
    payload: unknown;
    kind: ArtifactKind;
    taskId: string;
    summary?: string;
  }): Promise<{ reference: string; summary: string; isOffloaded: true; originalSizeBytes: number }> {
    const artifact = await this.storeArtifact(input);
    return {
      reference: artifact.id,
      summary: artifact.cognitiveSummary,
      isOffloaded: true,
      originalSizeBytes: artifact.sizeBytes,
    };
  }

  /**
   * Garbage collect expired artifacts.
   */
  gc(): number {
    const now = Date.now();
    let collected = 0;

    for (const [id, artifact] of this.artifacts) {
      if (artifact.expiresAt && new Date(artifact.expiresAt).getTime() < now) {
        // Delete from disk
        if (this.thresholds.persistToDisk && fs.existsSync(artifact.location)) {
          fs.unlinkSync(artifact.location);
        }
        this.artifacts.delete(id);
        collected++;
      }
    }

    return collected;
  }

  // ─── Getters ────────────────────────────────────────────────────────

  get size(): number {
    return this.artifacts.size;
  }

  getArtifact(id: string): TaskArtifact | undefined {
    return this.artifacts.get(id);
  }

  allArtifacts(): ReadonlyArray<Readonly<TaskArtifact>> {
    return Array.from(this.artifacts.values());
  }

  // ─── Summary Generation ─────────────────────────────────────────────

  private generateCognitiveSummary(payload: unknown, kind: ArtifactKind): string {
    const maxLen = this.thresholds.maxSummaryChars;

    switch (kind) {
      case 'scraped_content': {
        const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
        return this.truncateSummary(
          `[Web Scrape] ${text.slice(0, maxLen - 20)}${text.length > maxLen - 20 ? '...' : ''}`,
          maxLen,
        );
      }
      case 'sql_result_set': {
        const rows = Array.isArray(payload) ? payload : [];
        return this.truncateSummary(
          `[SQL Result] ${rows.length} rows returned. Columns: ${this.extractColumns(rows[0])}. First row: ${JSON.stringify(rows[0] ?? {}).slice(0, 200)}`,
          maxLen,
        );
      }
      case 'neo4j_traversal': {
        const data = payload as { nodes?: unknown[]; edges?: unknown[] };
        const nodeCount = data.nodes?.length ?? 0;
        const edgeCount = data.edges?.length ?? 0;
        return this.truncateSummary(
          `[Graph Traversal] ${nodeCount} nodes, ${edgeCount} relationships retrieved. Depth bounded at 5.`,
          maxLen,
        );
      }
      case 'temporal_coordinates': {
        return this.truncateSummary(
          `[Temporal] GSAP timeline coordinates retrieved. Coordinate details in artifact.`,
          maxLen,
        );
      }
      case 'audio_buffer': {
        return this.truncateSummary(
          `[Audio] TTS audio buffer generated. Size: ${JSON.stringify(payload).length} bytes. Stored for EdgeMeshBridge playback.`,
          maxLen,
        );
      }
      case 'atmosphere_snapshot': {
        return this.truncateSummary(
          `[Atmosphere] Visual/audio mutation triggers mapped to GSAP coordinates.`,
          maxLen,
        );
      }
      default: {
        const text = JSON.stringify(payload);
        return this.truncateSummary(
          `[${kind}] ${text.slice(0, maxLen - kind.length - 20)}${text.length > maxLen - kind.length - 20 ? '...' : ''}`,
          maxLen,
        );
      }
    }
  }

  private truncateSummary(summary: string, maxLen: number): string {
    if (summary.length <= maxLen) return summary;
    return summary.slice(0, maxLen - 3) + '...';
  }

  private extractColumns(row: unknown): string {
    if (!row || typeof row !== 'object') return 'unknown';
    return Object.keys(row).join(', ');
  }
}
