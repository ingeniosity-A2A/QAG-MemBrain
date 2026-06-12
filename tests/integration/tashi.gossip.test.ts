import { describe, expect, it } from "vitest";
import { InMemoryTashiNode } from "../../trust/tashi/gossip.js";
import { Vertex } from "../../trust/tashi/vertex.js";

function vertex(hash: string): Vertex {
  return {
    hash,
    parentHashes: [],
    creatorDid: "did:ava:test",
    signature: "sig",
    timestamp: Date.now(),
    payload: { hash },
  };
}

describe("Tashi gossip in-memory", () => {
  it("propagates across A -> B -> C and deduplicates", () => {
    const a = new InMemoryTashiNode("A");
    const b = new InMemoryTashiNode("B");
    const c = new InMemoryTashiNode("C");

    a.connect(b);
    b.connect(c);

    const v1 = vertex("h1");
    a.publish(v1);

    expect(a.vertexCount()).toBe(1);
    expect(b.vertexCount()).toBe(1);
    expect(c.vertexCount()).toBe(1);

    a.publish(v1);
    b.publish(v1);
    expect(a.vertexCount()).toBe(1);
    expect(b.vertexCount()).toBe(1);
    expect(c.vertexCount()).toBe(1);
  });

  it("replays on reconnect and flushes offline queue", () => {
    const a = new InMemoryTashiNode("A");
    const b = new InMemoryTashiNode("B");

    a.connect(b);
    b.goOffline();

    const queued = vertex("h2");
    b.publish(queued);
    expect(b.queuedCount()).toBe(1);
    expect(a.vertexCount()).toBe(0);

    b.goOnline();
    expect(b.queuedCount()).toBe(0);
    expect(a.vertexCount()).toBe(1);

    const c = new InMemoryTashiNode("C");
    b.connect(c);
    expect(c.vertexCount()).toBe(1);
    expect(c.knownVertexHashes()).toContain("h2");
  });
});
