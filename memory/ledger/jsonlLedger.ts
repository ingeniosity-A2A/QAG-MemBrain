import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { MemoryAtom, assertMemoryAtom } from "../atoms/memoryAtom.js";

const require = createRequire(import.meta.url);
type SchemaValidator = {
  (data: unknown): boolean;
  errors?: unknown;
};

const Ajv2020 = require("ajv/dist/2020").default as new (options?: Record<string, unknown>) => {
  compile: (schema: unknown) => SchemaValidator;
  errorsText: (
    errors?: unknown,
    options?: {
      separator?: string;
      dataVar?: string;
    },
  ) => string;
};
const addFormats = require("ajv-formats").default as (ajv: unknown) => void;

const memoryAtomSchema = JSON.parse(
  readFileSync(new URL("../schemas/memoryAtom.schema.json", import.meta.url), "utf8"),
) as Record<string, unknown>;

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateMemoryAtomSchema = ajv.compile(memoryAtomSchema);

export interface LedgerProof {
  id: string;
  hash: string;
  timestamp: string;
}

export interface LedgerEntry {
  atom: MemoryAtom;
  atomHash: string;
  hash: string;
  proof: LedgerProof;
}

export interface QueryFilter {
  actor?: string;
  type?: string;
  fromTimestamp?: string;
  toTimestamp?: string;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  return `{${entries
    .map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`)
    .join(",")}}`;
}

function computeHash(atom: MemoryAtom): string {
  const canonical = stableStringify(atom);
  return createHash("sha256").update(canonical).digest("hex");
}

function computePayloadHash(payload: unknown): string {
  const canonicalPayload = stableStringify(payload);
  return createHash("sha256").update(canonicalPayload).digest("hex");
}

function assertSchemaValidatedMemoryAtom(value: unknown): asserts value is MemoryAtom {
  if (!validateMemoryAtomSchema(value)) {
    const message = ajv.errorsText(validateMemoryAtomSchema.errors, { separator: "; " });
    throw new Error(`MemoryAtom schema validation failed: ${message}`);
  }

  assertMemoryAtom(value);
}

async function ensureLedgerFile(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  try {
    await stat(filePath);
  } catch {
    await writeFile(filePath, "", "utf8");
  }
}

async function readRawEntries(filePath: string): Promise<LedgerEntry[]> {
  await ensureLedgerFile(filePath);
  const raw = await readFile(filePath, "utf8");
  const lines = raw.split("\n").filter((line) => line.trim().length > 0);

  return lines.map((line) => {
    const parsed = JSON.parse(line) as LedgerEntry;
    assertSchemaValidatedMemoryAtom(parsed.atom);

    if (typeof parsed.hash !== "string" || parsed.hash.length === 0) {
      throw new Error("Invalid ledger entry hash");
    }

    if (typeof parsed.atomHash !== "string" || parsed.atomHash.length === 0) {
      throw new Error("Invalid ledger entry atomHash");
    }

    if (
      typeof parsed.proof !== "object" ||
      parsed.proof === null ||
      typeof parsed.proof.id !== "string" ||
      typeof parsed.proof.hash !== "string" ||
      typeof parsed.proof.timestamp !== "string"
    ) {
      throw new Error("Invalid ledger proof record");
    }

    return parsed;
  });
}

export async function appendAtom(filePath: string, atom: MemoryAtom): Promise<LedgerEntry> {
  assertSchemaValidatedMemoryAtom(atom);
  const existing = await readRawEntries(filePath);

  if (existing.some((entry) => entry.atom.id === atom.id)) {
    throw new Error(`Atom with id '${atom.id}' already exists; ledger is append-only`);
  }

  const payloadHash = computePayloadHash(atom.payload);
  const entry: LedgerEntry = {
    atom,
    atomHash: computeHash(atom),
    hash: payloadHash,
    proof: {
      id: atom.id,
      hash: payloadHash,
      timestamp: atom.timestamp,
    },
  };

  await writeFile(filePath, `${stableStringify(entry)}\n`, { encoding: "utf8", flag: "a" });
  return entry;
}

export async function readAtom(filePath: string, id: string): Promise<LedgerEntry | null> {
  const entries = await readRawEntries(filePath);
  return entries.find((entry) => entry.atom.id === id) ?? null;
}

export async function queryAtoms(filePath: string, filter: QueryFilter = {}): Promise<LedgerEntry[]> {
  const entries = await readRawEntries(filePath);

  const from = filter.fromTimestamp ? Date.parse(filter.fromTimestamp) : Number.NEGATIVE_INFINITY;
  const to = filter.toTimestamp ? Date.parse(filter.toTimestamp) : Number.POSITIVE_INFINITY;

  return entries.filter((entry) => {
    const ts = Date.parse(entry.atom.timestamp);
    const actorMatch = filter.actor ? entry.atom.actor === filter.actor : true;
    const typeMatch = filter.type ? entry.atom.type === filter.type : true;
    const timeMatch = ts >= from && ts <= to;
    return actorMatch && typeMatch && timeMatch;
  });
}

export async function verifyAtom(filePath: string, id: string): Promise<boolean> {
  const entry = await readAtom(filePath, id);
  if (!entry) {
    return false;
  }

  if (!validateMemoryAtomSchema(entry.atom)) {
    return false;
  }

  const payloadHash = computePayloadHash(entry.atom.payload);
  const atomHash = computeHash(entry.atom);

  const hashesMatch = entry.hash === payloadHash && entry.atomHash === atomHash;
  const proofMatches =
    entry.proof.id === entry.atom.id &&
    entry.proof.hash === payloadHash &&
    entry.proof.timestamp === entry.atom.timestamp;

  return hashesMatch && proofMatches;
}
