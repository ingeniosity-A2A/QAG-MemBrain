import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { assertCanWrite } from "../../contract/enforcement.js";
import { AtomicMemory, AuthorityLayer } from "../../shared/types.js";

export function fingerprintAtom(atom: Omit<AtomicMemory, "fingerprint" | "signature">): string {
  return createHash("sha256").update(JSON.stringify(atom)).digest("hex");
}

export function createAtomicMemory(input: Partial<AtomicMemory> & { content: string; source: string }): AtomicMemory {
  const base: Omit<AtomicMemory, "fingerprint"> = {
    id: input.id ?? randomUUID(),
    type: input.type ?? "memory",
    source: input.source,
    timestamp: input.timestamp ?? new Date().toISOString(),
    content: input.content,
    embedding: input.embedding,
    metadata: input.metadata ?? {},
    signature: input.signature,
    layer: input.layer ?? "L1",
  };
  return { ...base, fingerprint: fingerprintAtom(base) };
}

export class JSONLMemoryStore {
  constructor(private readonly filePath = "./data/memory.jsonl") {}

  async append(memory: AtomicMemory, layer: AuthorityLayer = memory.layer ?? "L1"): Promise<AtomicMemory> {
    assertCanWrite(layer);
    const record = memory.fingerprint ? memory : { ...memory, fingerprint: fingerprintAtom(memory) };
    await mkdir(dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, `${JSON.stringify(record)}\n`, "utf8");
    return record;
  }

  async query(predicate: (memory: AtomicMemory) => boolean = () => true): Promise<AtomicMemory[]> {
    const content = await readFile(this.filePath, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
    return content
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as AtomicMemory)
      .filter(predicate);
  }
}
