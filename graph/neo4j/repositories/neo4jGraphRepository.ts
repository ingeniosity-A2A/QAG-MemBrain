import { readFile } from "node:fs/promises";
import neo4j, { Driver, Session } from "neo4j-driver";
import { NODE_TYPES, CognitiveNode, Neo4jNodeType } from "../schema/nodeTypes.js";
import {
  CognitiveRelationship,
  Neo4jRelationshipType,
  RELATIONSHIP_TYPES,
} from "../schema/relationshipTypes.js";
import {
  CognitiveGraphRepository,
  GraphContext,
} from "./cognitiveGraphRepository.js";
import { VectorMatch } from "../vector/vectorIndex.js";

const ALLOWED_NODE_TYPES = new Set<string>(NODE_TYPES);
const ALLOWED_REL_TYPES = new Set<string>(RELATIONSHIP_TYPES);

function assertNodeType(value: string): asserts value is Neo4jNodeType {
  if (!ALLOWED_NODE_TYPES.has(value)) {
    throw new Error(`Unsupported node type '${value}'`);
  }
}

function assertRelationshipType(value: string): asserts value is Neo4jRelationshipType {
  if (!ALLOWED_REL_TYPES.has(value)) {
    throw new Error(`Unsupported relationship type '${value}'`);
  }
}

function getEmbedding(properties: Record<string, unknown>): number[] | null {
  const maybeEmbedding = properties.embedding;
  if (!Array.isArray(maybeEmbedding)) {
    return null;
  }

  const vector = maybeEmbedding.filter((value): value is number => typeof value === "number");
  return vector.length > 0 ? vector : null;
}

function recordToNode(record: neo4j.Record): CognitiveNode {
  const id = record.get("id") as string;
  const type = record.get("type") as Neo4jNodeType;
  const properties = record.get("properties") as Record<string, unknown>;
  return { id, type, properties };
}

export class Neo4jGraphRepository implements CognitiveGraphRepository {
  private readonly driver: Driver;

  constructor(uri: string, user: string, password: string) {
    this.driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
  }

  static fromEnv(): Neo4jGraphRepository {
    const uri = process.env.NEO4J_URI ?? "bolt://127.0.0.1:7687";
    const user = process.env.NEO4J_USER ?? "neo4j";
    const password = process.env.NEO4J_PASSWORD ?? "password";
    return new Neo4jGraphRepository(uri, user, password);
  }

  async close(): Promise<void> {
    await this.driver.close();
  }

  async ensurePhase1Schema(migrationFilePath: string): Promise<void> {
    const migration = await readFile(migrationFilePath, "utf8");
    const statements = migration
      .split(";")
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);

    const session = this.driver.session();
    try {
      for (const statement of statements) {
        await session.run(statement);
      }
    } finally {
      await session.close();
    }
  }

  async createNode(node: CognitiveNode): Promise<void> {
    assertNodeType(node.type);
    const session = this.driver.session();
    try {
      const query = `CREATE (n:${node.type} {id: $id}) SET n += $properties`;
      await session.run(query, { id: node.id, properties: node.properties });
    } finally {
      await session.close();
    }
  }

  async updateNode(node: CognitiveNode): Promise<void> {
    assertNodeType(node.type);
    const session = this.driver.session();
    try {
      const query = `MATCH (n:${node.type} {id: $id}) SET n += $properties RETURN n.id AS id`;
      const result = await session.run(query, { id: node.id, properties: node.properties });
      if (result.records.length === 0) {
        throw new Error(`Node '${node.id}' not found`);
      }
    } finally {
      await session.close();
    }
  }

  async upsertNode(node: CognitiveNode): Promise<void> {
    assertNodeType(node.type);
    const session = this.driver.session();
    try {
      const query = `MERGE (n:${node.type} {id: $id}) SET n += $properties`;
      await session.run(query, { id: node.id, properties: node.properties });
    } finally {
      await session.close();
    }
  }

  async createRelationship(relationship: CognitiveRelationship): Promise<void> {
    assertRelationshipType(relationship.type);
    const session = this.driver.session();
    try {
      const query = `
        MATCH (a {id: $fromId})
        MATCH (b {id: $toId})
        CREATE (a)-[r:${relationship.type}]->(b)
        SET r += $properties
        RETURN type(r) AS relationshipType
      `;

      const result = await session.run(query, {
        fromId: relationship.fromId,
        toId: relationship.toId,
        properties: relationship.properties ?? {},
      });

      if (result.records.length === 0) {
        throw new Error("Both relationship endpoints must exist before linking");
      }
    } finally {
      await session.close();
    }
  }

  async getNode(id: string): Promise<CognitiveNode | null> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        `MATCH (n {id: $id}) RETURN n.id AS id, head(labels(n)) AS type, properties(n) AS properties`,
        { id },
      );

      if (result.records.length === 0) {
        return null;
      }

      return recordToNode(result.records[0]);
    } finally {
      await session.close();
    }
  }

  async getOutgoing(id: string, type?: Neo4jRelationshipType): Promise<CognitiveRelationship[]> {
    if (type) {
      assertRelationshipType(type);
    }

    const session = this.driver.session();
    try {
      const query = type
        ? `
          MATCH (a {id: $id})-[r:${type}]->(b)
          RETURN a.id AS fromId, b.id AS toId, type(r) AS type, properties(r) AS properties
        `
        : `
          MATCH (a {id: $id})-[r]->(b)
          RETURN a.id AS fromId, b.id AS toId, type(r) AS type, properties(r) AS properties
        `;

      const result = await session.run(query, { id });

      return result.records.map((record) => ({
        fromId: record.get("fromId") as string,
        toId: record.get("toId") as string,
        type: record.get("type") as Neo4jRelationshipType,
        properties: record.get("properties") as Record<string, unknown>,
      }));
    } finally {
      await session.close();
    }
  }

  async getContext(id: string, type?: Neo4jRelationshipType): Promise<GraphContext> {
    const [node, outgoing] = await Promise.all([this.getNode(id), this.getOutgoing(id, type)]);
    return {
      node,
      outgoing,
      relatedNodeIds: outgoing.map((relationship) => relationship.toId),
    };
  }

  async vectorSearch(embedding: number[], topK: number): Promise<VectorMatch[]> {
    if (embedding.length === 0 || topK <= 0) {
      return [];
    }

    const session = this.driver.session();
    try {
      const result = await session.run(
        `
          CALL db.index.vector.queryNodes('memory_embedding_idx', $topK, $embedding)
          YIELD node, score
          RETURN node.id AS id, score
          ORDER BY score DESC
        `,
        { topK: neo4j.int(topK), embedding },
      );

      return result.records.map((record) => ({
        id: record.get("id") as string,
        score: record.get("score") as number,
      }));
    } finally {
      await session.close();
    }
  }

  async upsertEmbedding(nodeId: string, embedding: number[]): Promise<void> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        `MATCH (n {id: $nodeId}) SET n.embedding = $embedding RETURN n.id AS id`,
        { nodeId, embedding },
      );

      if (result.records.length === 0) {
        throw new Error(`Node '${nodeId}' not found`);
      }
    } finally {
      await session.close();
    }
  }

  async createOrUpdateNode(node: CognitiveNode): Promise<void> {
    const existing = await this.getNode(node.id);
    if (existing) {
      await this.updateNode(node);
      return;
    }

    await this.createNode(node);
  }

  async createNodeWithEmbedding(node: CognitiveNode): Promise<void> {
    await this.upsertNode(node);
    const embedding = getEmbedding(node.properties);
    if (embedding) {
      await this.upsertEmbedding(node.id, embedding);
    }
  }

  createSession(): Session {
    return this.driver.session();
  }
}
