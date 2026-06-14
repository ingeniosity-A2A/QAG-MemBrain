import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Neo4jGraphRepository } from "../../graph/neo4j/repositories/neo4jGraphRepository.js";

const migrationPath = join(process.cwd(), "graph/neo4j/cypher/001_phase1_authority_stack.cypher");
const VECTOR_DIMENSIONS = 1536;

function buildEmbedding(seed: number): number[] {
  const embedding = new Array<number>(VECTOR_DIMENSIONS).fill(0);
  embedding[0] = seed;
  return embedding;
}

const shouldRun =
  process.env.NEO4J_INTEGRATION === "1" &&
  Boolean(process.env.NEO4J_URI) &&
  Boolean(process.env.NEO4J_USER) &&
  Boolean(process.env.NEO4J_PASSWORD);

describe("Neo4j graph repository integration", () => {
  it.runIf(shouldRun)("applies migration and executes context traversal", async () => {
    const repository = Neo4jGraphRepository.fromEnv();

    try {
      await repository.ensurePhase1Schema(migrationPath);

      await repository.upsertNode({
        id: "mem-live-1",
        type: "Memory",
        properties: {
          actor: "agent:integration",
          embedding: buildEmbedding(1),
        },
      });

      await repository.upsertNode({
        id: "decision-live-1",
        type: "Decision",
        properties: {
          label: "integration",
        },
      });

      await repository.createRelationship({
        fromId: "mem-live-1",
        toId: "decision-live-1",
        type: "GENERATED",
        properties: { source: "integration-test" },
      });

      const context = await repository.getContext("mem-live-1", "GENERATED");
      expect(context.relatedNodeIds).toContain("decision-live-1");

      const results = await repository.vectorSearch(buildEmbedding(1), 1);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].id).toBe("mem-live-1");
    } finally {
      await repository.close();
    }
  });
});
