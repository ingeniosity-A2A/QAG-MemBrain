import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { MemoryAtom, assertMemoryAtom } from "../atoms/memoryAtom.js";

export interface LedgerEntry {
  atom: MemoryAtom;
  hash: string;
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
    assertMemoryAtom(parsed.atom);

    if (typeof parsed.hash !== "string" || parsed.hash.length === 0) {
      throw new Error("Invalid ledger entry hash");
    }

    return parsed;
  });
}

export async function appendAtom(filePath: string, atom: MemoryAtom): Promise<LedgerEntry> {
  assertMemoryAtom(atom);
  const existing = await readRawEntries(filePath);

  if (existing.some((entry) => entry.atom.id === atom.id)) {
    throw new Error(`Atom with id '${atom.id}' already exists; ledger is append-only`);
  }

  const entry: LedgerEntry = {
    atom,
    hash: computeHash(atom),
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

  const recomputed = computeHash(entry.atom);
  return recomputed === entry.hash;
}
