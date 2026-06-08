import neo4j, { Driver } from "neo4j-driver";
import { GRAPH_RAG_CONTEXT_QUERY } from "../cypher/queries.js";
import { CognitiveGraphRepository } from "../repositories/cognitiveGraphRepository.js";

export interface GraphRagContext {
  memoryId: string;
  relatedNodeIds: string[];
}

export interface GraphRagSeedContext {
  seedId: string;
  score: number;
  contextIds: string[];
  relationshipPaths: Array<
    Array<{
      type: string;
      fromId: string;
      toId: string;
      properties: Record<string, unknown>;
    }>
  >;
}

export interface GraphRagInterface {
  collectContext(memoryId: string): Promise<GraphRagContext>;
}

export class BasicGraphRag implements GraphRagInterface {
  constructor(private readonly repository: CognitiveGraphRepository) {}

  async collectContext(memoryId: string): Promise<GraphRagContext> {
    const context = await this.repository.getContext(memoryId);
    return {
      memoryId,
      relatedNodeIds: context.relatedNodeIds,
    };
  }
}

export async function retrieveGraphRagContext(input: {
  driver: Driver;
  embedding: number[];
  topK: number;
  depth: number;
}): Promise<GraphRagSeedContext[]> {
  if (input.embedding.length === 0 || input.topK <= 0 || input.depth < 0) {
    return [];
  }

  const session = input.driver.session();
  try {
    const result = await session.run(GRAPH_RAG_CONTEXT_QUERY, {
      embedding: input.embedding,
      topK: neo4j.int(input.topK),
      depth: neo4j.int(Math.min(input.depth, 5)),
    });

    return result.records.map((record) => ({
      seedId: record.get("seedId") as string,
      score: record.get("score") as number,
      contextIds: (record.get("contextIds") as unknown[]).filter((value): value is string => typeof value === "string"),
      relationshipPaths: record.get("relationshipPaths") as GraphRagSeedContext["relationshipPaths"],
    }));
  } finally {
    await session.close();
  }
}
