import * as fs from "fs/promises";
import { AtomicMemory } from "../shared/types.js";

export async function appendAtom(atom: AtomicMemory, filePath: string): Promise<void> {
  const line = JSON.stringify(atom) + "\n";
  await fs.appendFile(filePath, line, "utf-8");
}

export async function readAtoms(filePath: string, filter?: Partial<AtomicMemory>): Promise<AtomicMemory[]> {
  const content = await fs.readFile(filePath, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  const atoms = lines.map((l) => JSON.parse(l) as AtomicMemory);
  if (!filter) return atoms;
  return atoms.filter((atom) =>
    Object.entries(filter).every(([k, v]) => atom[k as keyof AtomicMemory] === v)
  );
}

export async function queryAtomsByTimeRange(
  filePath: string,
  start: Date,
  end: Date,
): Promise<AtomicMemory[]> {
  const all = await readAtoms(filePath);
  return all.filter((atom) => {
    const ts = new Date(atom.timestamp);
    return ts >= start && ts <= end;
  });
}
