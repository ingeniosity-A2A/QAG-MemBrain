import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { computeRecordHash } from "./hash.js";
import { MemoryQueryFilter, MemoryRecord, assertMemoryRecord } from "./memoryRecord.js";
import { verify, verifySignature } from "./signatureVerification.js";

export interface AppendOptions {
  publicKeyPem?: string;
  signatureVerifier?: (record: MemoryRecord) => boolean;
}

async function ensureFile(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  try {
    await stat(filePath);
  } catch {
    await writeFile(filePath, "", "utf8");
  }
}

async function readAll(filePath: string): Promise<MemoryRecord[]> {
  await ensureFile(filePath);
  const content = await readFile(filePath, "utf8");
  const lines = content.split("\n").filter((line) => line.trim().length > 0);
  const parsed = lines.map((line) => JSON.parse(line) as MemoryRecord);
  for (const record of parsed) {
    assertMemoryRecord(record);
  }

  return parsed;
}

function matches(record: MemoryRecord, filter: MemoryQueryFilter): boolean {
  const from = filter.fromTimestamp ? Date.parse(filter.fromTimestamp) : Number.NEGATIVE_INFINITY;
  const to = filter.toTimestamp ? Date.parse(filter.toTimestamp) : Number.POSITIVE_INFINITY;
  const ts = Date.parse(record.timestamp);

  if (filter.id && record.id !== filter.id) {
    return false;
  }

  if (filter.type && record.type !== filter.type) {
    return false;
  }

  if (filter.source && record.source !== filter.source) {
    return false;
  }

  if (filter.contentIncludes && !record.content.includes(filter.contentIncludes)) {
    return false;
  }

  return ts >= from && ts <= to;
}

export async function append(filePath: string, record: MemoryRecord, options: AppendOptions = {}): Promise<void> {
  assertMemoryRecord(record);
  if (!verify(record)) {
    throw new Error("MemoryRecord signature metadata is invalid or missing");
  }

  if (options.signatureVerifier && !options.signatureVerifier(record)) {
    throw new Error("MemoryRecord signature verification failed");
  }

  if (options.publicKeyPem && !verifySignature(record, options.publicKeyPem)) {
    throw new Error("MemoryRecord signature verification failed");
  }

  const records = await readAll(filePath);
  if (records.some((entry) => entry.id === record.id)) {
    throw new Error(`MemoryRecord with id '${record.id}' already exists`);
  }

  const latest = records.at(-1);
  if (!latest && typeof record.metadata.previous_hash !== "undefined") {
    throw new Error("Genesis MemoryRecord must not declare previous_hash");
  }

  if (latest && !record.metadata.previous_hash) {
    throw new Error("Non-genesis MemoryRecord must declare previous_hash");
  }

  if (latest && record.metadata.previous_hash) {
    const expected = computeRecordHash(latest);
    if (record.metadata.previous_hash !== expected) {
      throw new Error("MemoryRecord.metadata.previous_hash does not match previous record hash");
    }
  }

  await writeFile(filePath, `${JSON.stringify(record)}\n`, { encoding: "utf8", flag: "a" });
}

export async function* query(filePath: string, filter: MemoryQueryFilter = {}): AsyncIterable<MemoryRecord> {
  const records = await readAll(filePath);
  for (const record of records) {
    if (matches(record, filter)) {
      yield record;
    }
  }
}

export function createMemoryJsonlStore(filePath: string) {
  return {
    append: (record: MemoryRecord, options: AppendOptions = {}) => append(filePath, record, options),
    query: (filter: MemoryQueryFilter = {}) => query(filePath, filter),
    verify,
  };
}
