/**
 * ContextLake — main API for storing and retrieving AVA007's context.
 *
 * Phase 4.2 + Phase 5 — Arrow zero-copy + TASHI L2 DuckDB.
 *
 * This is the "memory" that AVA007 uses to remember conversations,
 * audit events, and inference results. Powered by DuckDB-WASM (Arrow
 * format internally — zero-copy between WASM and JS).
 *
 * Layers:
 *   L0 — RAM (in-memory cache, handled by Meta Harness AuditLogger)
 *   L1 — JSONL (filesystem, future)
 *   L2 — DuckDB (this module — persistent, queryable)
 *   L3 — GraphRAG (future)
 *   L4 — Archive (future)
 */

import { getDuckDBProvider, type DuckDBProvider } from './DuckDBProvider.js';

export interface StoredInference {
  trace_id: string;
  prompt: string;
  response: string;
  model_id: string;
  backend: string;
  latency_ms: number;
  token_count: number;
  tokens_per_sec: number;
  timestamp: string;
}

export interface StoredAuditEvent {
  trace_id: string;
  session_id: string | null;
  pillar: string;
  operation: string;
  phase: string;
  timestamp: string;
  error: string | null;
  result_summary: string | null;
}

export class ContextLake {
  private db: DuckDBProvider;

  constructor() {
    this.db = getDuckDBProvider();
  }

  async init(): Promise<void> {
    await this.db.init();
  }

  /**
   * Store an inference result in the context lake.
   * Data flows: JSON → DuckDB (Arrow format, zero-copy in WASM).
   */
  async storeInference(inference: StoredInference): Promise<void> {
    await this.db.insertInference(inference);
  }

  /**
   * Store an audit event in the context lake.
   */
  async storeAuditEvent(event: StoredAuditEvent): Promise<void> {
    await this.db.insertAuditEvent(event);
  }

  /**
   * Recall recent inferences (conversation history).
   * Returns Arrow Table from DuckDB (zero-copy).
   */
  async recallInferences(limit: number = 20): Promise<any> {
    return await this.db.queryInferences(limit);
  }

  /**
   * Recall recent audit events.
   */
  async recallAuditEvents(limit: number = 100): Promise<any> {
    return await this.db.queryAuditEvents(limit);
  }

  /**
   * Search inferences by keyword in prompt or response.
   */
  async searchInferences(keyword: string): Promise<any> {
    return await this.db.query(`
      SELECT * FROM inferences
      WHERE prompt LIKE '%${keyword}%'
         OR response LIKE '%${keyword}%'
      ORDER BY timestamp DESC
      LIMIT 50;
    `);
  }

  /**
   * Get stats for the admin info bar.
   */
  async getStats(): Promise<{ audit_events: number; inferences: number }> {
    return await this.db.getStats();
  }

  /**
   * Execute a raw SQL query (for future admin tools).
   */
  async query(sql: string): Promise<any> {
    return await this.db.query(sql);
  }

  async close(): Promise<void> {
    await this.db.close();
  }
}

/** Singleton instance. */
let _instance: ContextLake | null = null;

export function getContextLake(): ContextLake {
  if (!_instance) {
    _instance = new ContextLake();
  }
  return _instance;
}
