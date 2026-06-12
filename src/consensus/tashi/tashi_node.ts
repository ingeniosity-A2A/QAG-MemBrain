import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import { TashiVertex, TemporalCognitionSignature } from "../../shared/types.js";

export class TashiNode {
  private readonly dag = new Map<string, TashiVertex>();
  private readonly tips = new Set<string>();

  constructor(private readonly creator: string, private readonly ledgerPath = "./data/tashi/vertices.jsonl") {}

  async submit(payload: unknown, signature: TemporalCognitionSignature): Promise<TashiVertex> {
    const parents = [...this.tips];
    const vertexWithoutHash = { parents, signature, payload, creator: this.creator, timestamp: Date.now() };
    const hash = createHash("sha256").update(JSON.stringify(vertexWithoutHash)).digest("hex");
    const vertex: TashiVertex = { ...vertexWithoutHash, hash };
    this.dag.set(hash, vertex);
    this.tips.add(hash);
    for (const parent of parents) this.tips.delete(parent);
    await mkdir(dirname(this.ledgerPath), { recursive: true });
    await appendFile(this.ledgerPath, `${JSON.stringify(vertex)}\n`, "utf8");
    return vertex;
  }

  getTipHashes(): string[] {
    return [...this.tips];
  }
}
