import { computeRecordHash } from "../../jsonl/hash.js";
import { query, MemoryRecord } from "../../jsonl/index.js";
import { verify as verifySig, verifySignature } from "../../jsonl/signatureVerification.js";

export interface ReplayResult<TState> {
  state: TState;
  appliedRecords: MemoryRecord[];
}

export interface VerifyLedgerResult {
  valid: boolean;
  checkedRecords: number;
  failures: string[];
}

export interface VerifyLedgerOptions {
  publicKeyPem?: string;
  signatureVerifier?: (record: MemoryRecord) => boolean;
}

async function readLedger(filePath: string): Promise<MemoryRecord[]> {
  const records: MemoryRecord[] = [];
  for await (const record of query(filePath)) {
    records.push(record);
  }

  return records;
}

export async function verifyLedger(filePath: string, options: VerifyLedgerOptions = {}): Promise<VerifyLedgerResult> {
  const records = await readLedger(filePath);
  const failures: string[] = [];
  const ids = new Set<string>();
  let previous: MemoryRecord | null = null;

  for (const record of records) {
    if (ids.has(record.id)) {
      failures.push(`duplicate id: ${record.id}`);
    }
    ids.add(record.id);

    if (!verifySig(record)) {
      failures.push(`invalid record or signature metadata: ${record.id}`);
      continue;
    }

    if (options.signatureVerifier && !options.signatureVerifier(record)) {
      failures.push(`signature verification failed: ${record.id}`);
    }

    if (options.publicKeyPem && !verifySignature(record, options.publicKeyPem)) {
      failures.push(`signature verification failed: ${record.id}`);
    }

    if (!previous && typeof record.metadata?.previous_hash !== "undefined") {
      failures.push(`genesis record has previous_hash: ${record.id}`);
    }

    if (previous) {
      const expected = computeRecordHash(previous);
      if (!record.metadata?.previous_hash) {
        failures.push(`missing previous_hash: ${record.id}`);
      } else if (record.metadata.previous_hash !== expected) {
        failures.push(`previous_hash mismatch: ${record.id}`);
      }
    }

    previous = record;
  }

  return {
    valid: failures.length === 0,
    checkedRecords: records.length,
    failures,
  };
}

export async function replayFromGenesis<TState>(
  filePath: string,
  initialState: TState,
  reducer: (state: TState, record: MemoryRecord) => TState,
): Promise<ReplayResult<TState>> {
  const records = await readLedger(filePath);
  let state = initialState;
  for (const record of records) {
    state = reducer(state, record);
  }

  return {
    state,
    appliedRecords: records,
  };
}

export async function replayToTimestamp<TState>(
  filePath: string,
  timestamp: string,
  initialState: TState,
  reducer: (state: TState, record: MemoryRecord) => TState,
): Promise<ReplayResult<TState>> {
  const target = Date.parse(timestamp);
  if (Number.isNaN(target)) {
    throw new Error("Invalid timestamp for replayToTimestamp");
  }

  const records = await readLedger(filePath);
  const appliedRecords = records.filter((record) => record.timestamp <= target);

  let state = initialState;
  for (const record of appliedRecords) {
    state = reducer(state, record);
  }

  return {
    state,
    appliedRecords,
  };
}

export async function reconstructState<TState>(
  filePath: string,
  initialState: TState,
  reducer: (state: TState, record: MemoryRecord) => TState,
  timestamp?: string,
): Promise<TState> {
  if (timestamp) {
    const replayed = await replayToTimestamp(filePath, timestamp, initialState, reducer);
    return replayed.state;
  }

  const replayed = await replayFromGenesis(filePath, initialState, reducer);
  return replayed.state;
}
