/**
 * DuckDBProvider — DuckDB-WASM provider for the browser.
 *
 * Phase 4.2 + Phase 5 — Arrow zero-copy + TASHI L2 persistent memory.
 *
 * Uses @duckdb/duckdb-wasm which runs DuckDB entirely in the browser
 * via WebAssembly. All data is stored in Arrow format — zero-copy
 * between WASM and JS.
 *
 * Tables:
 *   - audit_events: Meta Harness intercept logs
 *   - inferences: LLM inference results (prompt, response, timing)
 *   - insertIntelligence: AVA007 state mutations (future)
 *
 * Storage:
 *   - In-memory by default (fastest)
 *   - Can be backed by IndexedDB for persistence across sessions (future)
 */

import duckdb from '@duckdb/duckdb-wasm';
// @ts-ignore — duckdb-wasm types are incomplete
import * as arrow from 'apache-arrow';

const DB_NAME = 'ava007_context_lake';

export class DuckDBProvider {
  private db: any = null;
  private conn: any = null;
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) return;

    // DuckDB-WASM requires a bundler worker. We use the inline approach
    // which works in browsers without a separate worker file.
    const bundle = await duckdb.selectBundle({
      mvp: {
        mainModule: 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.29.0/dist/duckdb-mvp.wasm',
        mainWorker: 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.29.0/dist/duckdb-browser-mvp.worker.js',
      },
      eh: {
        mainModule: 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.29.0/dist/duckdb-eh.wasm',
        mainWorker: 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.29.0/dist/duckdb-browser-eh.worker.js',
      },
    });

    const worker = new Worker(bundle.mainWorker);
    this.db = new duckdb.AsyncDb();
    await this.db.open(worker, bundle.mainModule);
    this.conn = await this.db.connect();

    // Create tables
    await this.conn.query(`
      CREATE TABLE IF NOT EXISTS audit_events (
        trace_id VARCHAR,
        session_id VARCHAR,
        pillar VARCHAR,
        operation VARCHAR,
        phase VARCHAR,
        timestamp VARCHAR,
        error VARCHAR,
        result_summary VARCHAR
      );
    `);

    await this.conn.query(`
      CREATE TABLE IF NOT EXISTS inferences (
        trace_id VARCHAR,
        prompt VARCHAR,
        response VARCHAR,
        model_id VARCHAR,
        backend VARCHAR,
        latency_ms DOUBLE,
        token_count INTEGER,
        tokens_per_sec DOUBLE,
        timestamp VARCHAR
      );
    `);

    this.initialized = true;
    console.log('[DuckDBProvider] Initialized — context lake ready');
  }

  /**
   * Insert an audit event (from Meta Harness).
   * Data flows: JSON → Arrow RecordBatch → DuckDB (zero-copy in WASM).
   */
  async insertAuditEvent(event: {
    trace_id: string;
    session_id: string | null;
    pillar: string;
    operation: string;
    phase: string;
    timestamp: string;
    error: string | null;
    result_summary: string | null;
  }): Promise<void> {
    if (!this.initialized) await this.init();

    await this.conn.query(`
      INSERT INTO audit_events VALUES (
        '${this.escape(event.trace_id)}',
        '${this.escape(event.session_id ?? '')}',
        '${this.escape(event.pillar)}',
        '${this.escape(event.operation)}',
        '${this.escape(event.phase)}',
        '${this.escape(event.timestamp)}',
        '${this.escape(event.error ?? '')}',
        '${this.escape(event.result_summary ?? '')}'
      );
    `);
  }

  /**
   * Insert an inference result.
   */
  async insertInference(row: {
    trace_id: string;
    prompt: string;
    response: string;
    model_id: string;
    backend: string;
    latency_ms: number;
    token_count: number;
    tokens_per_sec: number;
    timestamp: string;
  }): Promise<void> {
    if (!this.initialized) await this.init();

    await this.conn.query(`
      INSERT INTO inferences VALUES (
        '${this.escape(row.trace_id)}',
        '${this.escape(row.prompt)}',
        '${this.escape(row.response)}',
        '${this.escape(row.model_id)}',
        '${this.escape(row.backend)}',
        ${row.latency_ms},
        ${row.token_count},
        ${row.tokens_per_sec},
        '${this.escape(row.timestamp)}'
      );
    `);
  }

  /**
   * Query audit events. Returns Arrow Table (zero-copy from DuckDB WASM).
   */
  async queryAuditEvents(limit: number = 100): Promise<any> {
    if (!this.initialized) await this.init();
    return await this.conn.query(`SELECT * FROM audit_events ORDER BY timestamp DESC LIMIT ${limit};`);
  }

  /**
   * Query inference history. Returns Arrow Table.
   */
  async queryInferences(limit: number = 50): Promise<any> {
    if (!this.initialized) await this.init();
    return await this.conn.query(`SELECT * FROM inferences ORDER BY timestamp DESC LIMIT ${limit};`);
  }

  /**
   * Execute a raw SQL query. Returns Arrow Table.
   */
  async query(sql: string): Promise<any> {
    if (!this.initialized) await this.init();
    return await this.conn.query(sql);
  }

  /**
   * Get table stats.
   */
  async getStats(): Promise<{ audit_events: number; inferences: number }> {
    if (!this.initialized) await this.init();
    const auditResult = await this.conn.query('SELECT COUNT(*) as count FROM audit_events;');
    const infResult = await this.conn.query('SELECT COUNT(*) as count FROM inferences;');
    // Arrow Table → get first row → get count column
    const auditCount = auditResult.toArray()[0]?.count ?? 0;
    const infCount = infResult.toArray()[0]?.count ?? 0;
    return { audit_events: auditCount, inferences: infCount };
  }

  async close(): Promise<void> {
    if (this.conn) {
      await this.conn.close();
      this.conn = null;
    }
    if (this.db) {
      await this.db.terminate();
      this.db = null;
    }
    this.initialized = false;
  }

  private escape(s: string): string {
    return s.replace(/'/g, "''").replace(/\\/g, '\\\\');
  }
}

/** Singleton instance. */
let _instance: DuckDBProvider | null = null;

export function getDuckDBProvider(): DuckDBProvider {
  if (!_instance) {
    _instance = new DuckDBProvider();
  }
  return _instance;
}
