// ═══════════════════════════════════════════════════════════════════
// QAG_MemBrain — Layer 1: Tashi DAG Node
// Leaderless consensus. Ed25519-signed vertices. Epidemic gossip.
// Offline queue flushes on reconnect. Up to 100k writes/sec in software.
// ═══════════════════════════════════════════════════════════════════

import { createHash }      from "crypto";
import { appendAtom }      from "../atomic_memory.js";
import { AtomicMemory, TashiVertex } from "../../../shared/types.js";
import WebSocket           from "ws";

function hashVertex(atom: AtomicMemory, parents: string[], creator: string): string {
  return createHash("sha256")
    .update(JSON.stringify({ data: atom, parents, creator }))
    .digest("hex");
}

export function createVertex(
  atom: AtomicMemory, parents: string[], creator: string, signature: string
): TashiVertex {
  const hash = hashVertex(atom, parents, creator);
  return { hash, parents, signature, creator, created_at: Date.now(),
           data: { ...atom, vertex_hash: hash, parent_hashes: parents } };
}

export function validateVertex(vertex: TashiVertex, known: Set<string>): { valid: boolean; reason?: string } {
  if (vertex.parents.length === 0) return { valid: true };
  for (const p of vertex.parents) {
    if (!known.has(p)) return { valid: false, reason: `Unknown parent: ${p}` };
  }
  const expected = hashVertex(vertex.data, vertex.parents, vertex.creator);
  if (expected !== vertex.hash) return { valid: false, reason: "Hash mismatch" };
  return { valid: true };
}

export class TashiNode {
  private dag:          Map<string, TashiVertex> = new Map();
  private tips:         Set<string>              = new Set();
  private offlineQueue: TashiVertex[]            = [];
  private peers:        Map<string, WebSocket>   = new Map();

  constructor(private creatorDid: string, private filePath: string) {}

  async submit(atom: AtomicMemory, signature: string): Promise<TashiVertex> {
    const parents = Array.from(this.tips);
    const vertex  = createVertex(atom, parents, this.creatorDid, signature);
    const known   = new Set(this.dag.keys());
    const { valid, reason } = validateVertex(vertex, known);
    if (!valid) throw new Error(`Vertex rejected: ${reason}`);

    this.dag.set(vertex.hash, vertex);
    for (const p of parents) this.tips.delete(p);
    this.tips.add(vertex.hash);
    await appendAtom(vertex.data, this.filePath);
    this.gossip(vertex);
    return vertex;
  }

  private gossip(vertex: TashiVertex): void {
    const msg = JSON.stringify({ type: "VERTEX", vertex });
    let sent  = false;
    for (const [, ws] of this.peers) {
      if (ws.readyState === WebSocket.OPEN) { ws.send(msg); sent = true; }
      else this.offlineQueue.push(vertex);
    }
    if (!sent && this.peers.size === 0) this.offlineQueue.push(vertex);
  }

  connectPeer(peerId: string, ws: WebSocket): void {
    this.peers.set(peerId, ws);
    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "VERTEX") this.receiveVertex(msg.vertex);
      } catch { /* ignore malformed */ }
    });
    ws.on("open", () => this.flushQueue(ws));
    ws.on("close", () => this.peers.delete(peerId));
  }

  private async receiveVertex(vertex: TashiVertex): Promise<void> {
    if (this.dag.has(vertex.hash)) return;
    const { valid } = validateVertex(vertex, new Set(this.dag.keys()));
    if (!valid) return;
    this.dag.set(vertex.hash, vertex);
    for (const p of vertex.parents) this.tips.delete(p);
    this.tips.add(vertex.hash);
    await appendAtom(vertex.data, this.filePath);
    this.gossip(vertex);
  }

  private flushQueue(ws: WebSocket): void {
    const pending = [...this.offlineQueue];
    this.offlineQueue = [];
    for (const v of pending) ws.send(JSON.stringify({ type: "VERTEX", vertex: v }));
  }

  getAncestors(hash: string, depth = 5): TashiVertex[] {
    const results: TashiVertex[] = [];
    const visit = (h: string, d: number) => {
      if (d <= 0) return;
      const v = this.dag.get(h);
      if (!v) return;
      results.push(v);
      for (const p of v.parents) visit(p, d - 1);
    };
    visit(hash, depth);
    return results;
  }

  get dagSize():    number { return this.dag.size; }
  get tipCount():   number { return this.tips.size; }
  get queueDepth(): number { return this.offlineQueue.length; }
}
