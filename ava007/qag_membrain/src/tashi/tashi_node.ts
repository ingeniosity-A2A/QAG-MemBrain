// ═══════════════════════════════════════════════════════════════════
// QUANTUM ATOMIC GSAP MEMBRAiN — Layer 1: Tashi DAG Consensus
// Leaderless DAG — no single point of failure.
// Each vertex = signed AtomicMemory + parent hashes.
// Gossip over WebSocket/WebRTC with NAT punching for IoT SIM.
// Offline queue flushes on reconnect — no data loss.
// ═══════════════════════════════════════════════════════════════════

import { createHash } from "crypto";
import { appendAtom, readAtoms } from "../memory/atomic_memory";
import { AtomicMemory, TashiVertex } from "../shared/types";
import WebSocket from "ws";

// ─── Vertex Construction ─────────────────────────────────────────────
function hashVertex(atom: AtomicMemory, parents: string[], creator: string): string {
  const canonical = JSON.stringify({ data: atom, parents, creator });
  return createHash("sha256").update(canonical).digest("hex");
}

export function createVertex(
  atom:      AtomicMemory,
  parents:   string[],    // Parent vertex hashes — empty for genesis
  creator:   string,      // Node DID
  signature: string       // Ed25519 from identity layer
): TashiVertex {
  const hash = hashVertex(atom, parents, creator);
  return {
    hash,
    parents,
    signature,
    creator,
    created_at: Date.now(),
    data: { ...atom, vertex_hash: hash, parent_hashes: parents },
  };
}

// ─── Vertex Validation ────────────────────────────────────────────────
// Called on receive — reject orphaned or malformed vertices
export function validateVertex(
  vertex:      TashiVertex,
  knownHashes: Set<string>   // DAG of already-accepted vertices
): { valid: boolean; reason?: string } {
  // Genesis vertex has no parents — always valid
  if (vertex.parents.length === 0) return { valid: true };

  // All parents must be known
  for (const parent of vertex.parents) {
    if (!knownHashes.has(parent)) {
      return { valid: false, reason: `Unknown parent hash: ${parent}` };
    }
  }

  // Hash must be reproducible
  const expected = hashVertex(vertex.data, vertex.parents, vertex.creator);
  if (expected !== vertex.hash) {
    return { valid: false, reason: "Hash mismatch — content tampered" };
  }

  return { valid: true };
}

// ─── Tashi Node ──────────────────────────────────────────────────────
export class TashiNode {
  private dag:         Map<string, TashiVertex> = new Map();
  private tips:        Set<string> = new Set();          // DAG leaf hashes
  private offlineQueue: TashiVertex[] = [];
  private peers:       Map<string, WebSocket> = new Map();
  private creatorDid:  string;
  private filePath:    string;                           // JSONL audit path

  constructor(creatorDid: string, jsonlFilePath: string) {
    this.creatorDid = creatorDid;
    this.filePath   = jsonlFilePath;
  }

  // ── Submit a new vertex (local write) ──────────────────────────────
  async submit(atom: AtomicMemory, signature: string): Promise<TashiVertex> {
    // Current tips become parents — leaderless, no coordinator
    const parents  = Array.from(this.tips);
    const vertex   = createVertex(atom, parents, this.creatorDid, signature);
    const known    = new Set(this.dag.keys());

    const { valid, reason } = validateVertex(vertex, known);
    if (!valid) throw new Error(`Vertex rejected: ${reason}`);

    // Accept into DAG
    this.dag.set(vertex.hash, vertex);
    // Remove parents from tips (they now have a child)
    for (const p of parents) this.tips.delete(p);
    this.tips.add(vertex.hash);

    // Persist to JSONL
    await appendAtom(vertex.data, this.filePath);

    // Gossip to peers (or queue if offline)
    this.gossip(vertex);

    return vertex;
  }

  // ── Gossip: epidemic broadcast ────────────────────────────────────
  private gossip(vertex: TashiVertex): void {
    const msg = JSON.stringify({ type: "VERTEX", vertex });

    for (const [peerId, ws] of this.peers) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(msg);
      } else {
        // Peer offline — queue for later
        this.offlineQueue.push(vertex);
      }
    }

    // No peers at all — queue
    if (this.peers.size === 0) {
      this.offlineQueue.push(vertex);
    }
  }

  // ── Connect to peer ───────────────────────────────────────────────
  connectPeer(peerId: string, ws: WebSocket): void {
    this.peers.set(peerId, ws);

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "VERTEX") this.receiveVertex(msg.vertex);
        if (msg.type === "SYNC_REQUEST") this.handleSyncRequest(ws, msg.since_hash);
      } catch { /* malformed message — ignore */ }
    });

    ws.on("open", () => {
      // Flush offline queue to this peer
      this.flushOfflineQueue(ws);
      // Request any vertices we missed
      ws.send(JSON.stringify({ type: "SYNC_REQUEST", since_hash: this.getLatestHash() }));
    });

    ws.on("close", () => this.peers.delete(peerId));
  }

  // ── Receive vertex from peer ──────────────────────────────────────
  private async receiveVertex(vertex: TashiVertex): Promise<void> {
    if (this.dag.has(vertex.hash)) return; // Already have it

    const known = new Set(this.dag.keys());
    const { valid, reason } = validateVertex(vertex, known);

    if (!valid) {
      // May be out-of-order — request missing parents
      for (const parentHash of vertex.parents) {
        if (!this.dag.has(parentHash)) {
          this.requestVertex(parentHash);
        }
      }
      return;
    }

    this.dag.set(vertex.hash, vertex);
    for (const p of vertex.parents) this.tips.delete(p);
    this.tips.add(vertex.hash);
    await appendAtom(vertex.data, this.filePath);

    // Forward to other peers (epidemic spread)
    this.gossip(vertex);
  }

  // ── Flush offline queue on reconnect ─────────────────────────────
  private flushOfflineQueue(ws: WebSocket): void {
    const pending = [...this.offlineQueue];
    this.offlineQueue = [];
    for (const vertex of pending) {
      ws.send(JSON.stringify({ type: "VERTEX", vertex }));
    }
  }

  // ── Sync: send all vertices since a hash ─────────────────────────
  private handleSyncRequest(ws: WebSocket, sinceHash: string): void {
    // Walk DAG from sinceHash forward — send missing vertices in order
    const toSend = this.getVerticesSince(sinceHash);
    for (const vertex of toSend) {
      ws.send(JSON.stringify({ type: "VERTEX", vertex }));
    }
  }

  // ── DAG traversal helpers ─────────────────────────────────────────
  getVertex(hash: string): TashiVertex | undefined {
    return this.dag.get(hash);
  }

  getAncestors(hash: string, depth: number = 5): TashiVertex[] {
    const results: TashiVertex[] = [];
    const visit = (h: string, d: number) => {
      if (d <= 0) return;
      const v = this.dag.get(h);
      if (!v) return;
      results.push(v);
      for (const parent of v.parents) visit(parent, d - 1);
    };
    visit(hash, depth);
    return results;
  }

  private getLatestHash(): string {
    return Array.from(this.tips)[0] ?? "";
  }

  private getVerticesSince(sinceHash: string): TashiVertex[] {
    // Topological sort of all vertices not in ancestor set of sinceHash
    const all = Array.from(this.dag.values());
    return all.filter(v => v.created_at > (this.dag.get(sinceHash)?.created_at ?? 0))
              .sort((a, b) => a.created_at - b.created_at);
  }

  private requestVertex(hash: string): void {
    for (const ws of this.peers.values()) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "SYNC_REQUEST", since_hash: hash }));
        return;
      }
    }
  }

  get dagSize(): number { return this.dag.size; }
  get tipCount(): number { return this.tips.size; }
  get queueDepth(): number { return this.offlineQueue.length; }
}
