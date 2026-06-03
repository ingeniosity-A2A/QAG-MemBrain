import { describe, expect, it } from "vitest";
import { BasicGraphRag } from "../../graph/neo4j/graphrag/graphRag.js";
import { InMemoryCognitiveGraphRepository } from "../../graph/neo4j/repositories/cognitiveGraphRepository.js";

describe("Graph repository contracts", () => {
  it("supports context traversal and vector search", async () => {
    const repository = new InMemoryCognitiveGraphRepository();

    await repository.createNode({
      id: "mem-graph-1",
      type: "Memory",
      properties: {
        actor: "agent:test",
        embedding: [1, 0, 0],
      },
    });

    await repository.createNode({
      id: "decision-graph-1",
      type: "Decision",
      properties: { embedding: [0.9, 0.1, 0] },
    });

    await repository.createRelationship({
      fromId: "mem-graph-1",
      toId: "decision-graph-1",
      type: "GENERATED",
      properties: { strength: 1 },
    });

    const context = await repository.getContext("mem-graph-1");
    expect(context.relatedNodeIds).toContain("decision-graph-1");

    const rag = new BasicGraphRag(repository);
    const ragContext = await rag.collectContext("mem-graph-1");
    expect(ragContext.relatedNodeIds).toContain("decision-graph-1");

    const matches = await repository.vectorSearch([1, 0, 0], 2);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].id).toBe("mem-graph-1");
  });
});
