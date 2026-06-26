/**
 * Context Lake — index for src/context_lake/.
 *
 * Phase 4.2 + Phase 5 — Arrow zero-copy + TASHI L2 DuckDB.
 *
 * The Context Lake is AVA007's persistent memory layer. It stores
 * audit events and inference results in DuckDB-WASM (which uses
 * Apache Arrow format internally — zero-copy between WASM and JS).
 *
 * Usage:
 *   import { getContextLake } from './context_lake';
 *   const lake = getContextLake();
 *   await lake.init();
 *   await lake.storeInference({ trace_id, prompt, response, ... });
 *   const recent = await lake.recallInferences(20);
 */

export { ContextLake, getContextLake, type StoredInference, type StoredAuditEvent } from './ContextLake.js';
export { DuckDBProvider, getDuckDBProvider } from './DuckDBProvider.js';
export { ArrowBridge, type AuditEventRow, type InferenceRow } from './ArrowBridge.js';
