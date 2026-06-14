import { Vertex } from "./vertex.js";

export class InMemoryTashiNode {
  private readonly peers = new Set<InMemoryTashiNode>();
  private readonly vertices = new Map<string, Vertex>();
  private readonly offlineQueue: Vertex[] = [];
  private online = true;

  constructor(public readonly nodeId: string) {}

  connect(peer: InMemoryTashiNode): void {
    if (peer === this) {
      return;
    }

    this.peers.add(peer);
    peer.peers.add(this);

    this.replayKnownToPeer(peer);
    peer.replayKnownToPeer(this);
  }

  disconnect(peer: InMemoryTashiNode): void {
    this.peers.delete(peer);
    peer.peers.delete(this);
  }

  goOffline(): void {
    this.online = false;
  }

  goOnline(): void {
    this.online = true;
    this.flushOfflineQueue();
  }

  publish(vertex: Vertex): void {
    if (!this.online) {
      this.offlineQueue.push(vertex);
      return;
    }

    this.receive(vertex);
  }

  receive(vertex: Vertex, from?: InMemoryTashiNode): void {
    if (!this.online) {
      this.offlineQueue.push(vertex);
      return;
    }

    const existing = this.vertices.get(vertex.hash);
    if (existing) {
      return;
    }

    this.vertices.set(vertex.hash, vertex);

    for (const peer of this.peers) {
      if (peer !== from) {
        peer.receive(vertex, this);
      }
    }
  }

  knownVertexHashes(): string[] {
    return Array.from(this.vertices.keys()).sort((a, b) => a.localeCompare(b));
  }

  vertexCount(): number {
    return this.vertices.size;
  }

  queuedCount(): number {
    return this.offlineQueue.length;
  }

  private flushOfflineQueue(): void {
    while (this.offlineQueue.length > 0) {
      const vertex = this.offlineQueue.shift();
      if (vertex) {
        this.receive(vertex);
      }
    }
  }

  private replayKnownToPeer(peer: InMemoryTashiNode): void {
    for (const vertex of this.vertices.values()) {
      peer.receive(vertex, this);
    }
  }
}
