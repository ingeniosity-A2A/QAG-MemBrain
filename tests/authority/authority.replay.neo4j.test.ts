import { describe, expect, it } from "vitest";
import { InMemoryCognitiveGraphRepository } from "../../graph/neo4j/repositories/cognitiveGraphRepository.js";

describe("Authority replay Neo4j history links", () => {
  it("supports replay nodes and replay relationships", async () => {
    const repository = new InMemoryCognitiveGraphRepository();

    await repository.createNode({ id: "decision-1", type: "Decision", properties: {} });
    await repository.createNode({ id: "replay-1", type: "Replay", properties: { replayId: "replay-1" } });

    await repository.createRelationship({ fromId: "decision-1", toId: "replay-1", type: "VERIFIED_BY" });

    const context = await repository.getContext("decision-1");
    expect(context.relatedNodeIds).toContain("replay-1");
    expect(context.outgoing[0].type).toBe("VERIFIED_BY");
  });

  it("allows failed replay links as well", async () => {
    const repository = new InMemoryCognitiveGraphRepository();

    await repository.createNode({ id: "decision-2", type: "Decision", properties: {} });
    await repository.createNode({ id: "replay-2", type: "Replay", properties: { replayId: "replay-2" } });

    await repository.createRelationship({ fromId: "decision-2", toId: "replay-2", type: "FAILED_BY" });

    const context = await repository.getContext("decision-2");
    expect(context.relatedNodeIds).toContain("replay-2");
    expect(context.outgoing[0].type).toBe("FAILED_BY");
  });
});