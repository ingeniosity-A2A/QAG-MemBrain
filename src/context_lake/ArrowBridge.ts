/**
 * ArrowBridge — converts between JSON and Apache Arrow RecordBatches.
 *
 * Phase 4.2 — Arrow zero-copy in the browser.
 *
 * Uses `apache-arrow` npm package which provides Arrow types that work
 * in WASM linear memory. When DuckDB-WASM returns query results, they
 * come back as Arrow RecordBatches — zero-copy between WASM and JS.
 *
 * Flow:
 *   llama-server JSON → ArrowBridge.toRecordBatch() → DuckDB insert (zero-copy)
 *   DuckDB query → Arrow RecordBatch → ArrowBridge.toJSON() → JS object
 */

import {
  Table as ArrowTable,
  RecordBatchStreamReader,
  RecordBatchStreamWriter,
  tableFromIPC,
  tableToIPC,
  vectorFromArray,
  Utf8,
  Int32,
  Float64,
  TimestampMillisecond,
  Field,
  Schema,
  type Table,
} from 'apache-arrow';

export interface AuditEventRow {
  trace_id: string;
  session_id: string | null;
  pillar: string;
  operation: string;
  phase: string;
  timestamp: string;
  error: string | null;
  result_summary: string | null;
}

export interface InferenceRow {
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

export class ArrowBridge {
  /**
   * Convert a JSON object (audit event) to an Arrow Table.
   * This creates an Arrow Table in WASM memory — zero-copy from here to DuckDB.
   */
  static auditEventsToTable(events: AuditEventRow[]): Table {
    const traceIds = vectorFromArray(events.map(e => e.trace_id), new Utf8());
    const sessionIds = vectorFromArray(events.map(e => e.session_id ?? ''), new Utf8());
    const pillars = vectorFromArray(events.map(e => e.pillar), new Utf8());
    const operations = vectorFromArray(events.map(e => e.operation), new Utf8());
    const phases = vectorFromArray(events.map(e => e.phase), new Utf8());
    const timestamps = vectorFromArray(events.map(e => e.timestamp), new Utf8());
    const errors = vectorFromArray(events.map(e => e.error ?? ''), new Utf8());
    const resultSummaries = vectorFromArray(events.map(e => e.result_summary ?? ''), new Utf8());

    return new ArrowTable({
      trace_id: traceIds,
      session_id: sessionIds,
      pillar: pillars,
      operation: operations,
      phase: phases,
      timestamp: timestamps,
      error: errors,
      result_summary: resultSummaries,
    });
  }

  /**
   * Convert a JSON object (inference result) to an Arrow Table.
   */
  static inferenceToTable(rows: InferenceRow[]): Table {
    const traceIds = vectorFromArray(rows.map(r => r.trace_id), new Utf8());
    const prompts = vectorFromArray(rows.map(r => r.prompt), new Utf8());
    const responses = vectorFromArray(rows.map(r => r.response), new Utf8());
    const modelIds = vectorFromArray(rows.map(r => r.model_id), new Utf8());
    const backends = vectorFromArray(rows.map(r => r.backend), new Utf8());
    const latencyMs = vectorFromArray(rows.map(r => r.latency_ms), new Float64());
    const tokenCounts = vectorFromArray(rows.map(r => r.token_count), new Int32());
    const tokensPerSec = vectorFromArray(rows.map(r => r.tokens_per_sec), new Float64());
    const timestamps = vectorFromArray(rows.map(r => r.timestamp), new Utf8());

    return new ArrowTable({
      trace_id: traceIds,
      prompt: prompts,
      response: responses,
      model_id: modelIds,
      backend: backends,
      latency_ms: latencyMs,
      token_count: tokenCounts,
      tokens_per_sec: tokensPerSec,
      timestamp: timestamps,
    });
  }

  /**
   * Convert an Arrow Table back to JSON objects.
   * Used when reading query results from DuckDB.
   */
  static tableToJSON<T = Record<string, unknown>>(table: Table): T[] {
    const results: T[] = [];
    for (const row of table) {
      const obj: Record<string, unknown> = {};
      for (const field of table.schema.fields) {
        obj[field.name] = row.get(field.name);
      }
      results.push(obj as T);
    }
    return results;
  }

  /**
   * Serialize an Arrow Table to IPC bytes (for passing to DuckDB-WASM).
   * IPC (Inter-Process Communication) format is the Arrow binary standard.
   */
  static tableToIPC(table: Table): Uint8Array {
    return tableToIPC(table);
  }

  /**
   * Deserialize IPC bytes back to an Arrow Table.
   * Used when receiving results from DuckDB-WASM.
   */
  static tableFromIPC(bytes: Uint8Array): Table {
    return tableFromIPC(bytes);
  }
}
