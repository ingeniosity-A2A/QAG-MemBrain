import { CognitiveNode } from "../schema/nodeTypes.js";
import { CognitiveRelationship, Neo4jRelationshipType } from "../schema/relationshipTypes.js";
import { VectorMatch } from "../vector/vectorIndex.js";

export interface GraphContext {
  node: CognitiveNode | null;
  outgoing: CognitiveRelationship[];
  relatedNodeIds: string[];
}

export interface CognitiveGraphRepository {
  createNode(node: CognitiveNode): Promise<void>;
  updateNode(node: CognitiveNode): Promise<void>;
  upsertNode(node: CognitiveNode): Promise<void>;
  createRelationship(relationship: CognitiveRelationship): Promise<void>;
  getNode(id: string): Promise<CognitiveNode | null>;
  getOutgoing(id: string, type?: Neo4jRelationshipType): Promise<CognitiveRelationship[]>;
  getContext(id: string, type?: Neo4jRelationshipType): Promise<GraphContext>;
  vectorSearch(embedding: number[], topK: number): Promise<VectorMatch[]>;
}

export class InMemoryCognitiveGraphRepository implements CognitiveGraphRepository {
  private readonly nodes = new Map<string, CognitiveNode>();
  private readonly relationships: CognitiveRelationship[] = [];

  async createNode(node: CognitiveNode): Promise<void> {
    if (this.nodes.has(node.id)) {
      throw new Error(`Node '${node.id}' already exists`);
    }

    this.nodes.set(node.id, node);
  }

  async updateNode(node: CognitiveNode): Promise<void> {
    if (!this.nodes.has(node.id)) {
      throw new Error(`Node '${node.id}' does not exist`);
    }

    this.nodes.set(node.id, node);
  }

  async upsertNode(node: CognitiveNode): Promise<void> {
    this.nodes.set(node.id, node);
  }

  async createRelationship(relationship: CognitiveRelationship): Promise<void> {
    const fromExists = this.nodes.has(relationship.fromId);
    const toExists = this.nodes.has(relationship.toId);

    if (!fromExists || !toExists) {
      throw new Error("Both relationship endpoints must exist before linking");
    }

    this.relationships.push(relationship);
  }

  async getNode(id: string): Promise<CognitiveNode | null> {
    return this.nodes.get(id) ?? null;
  }

  async getOutgoing(id: string, type?: Neo4jRelationshipType): Promise<CognitiveRelationship[]> {
    return this.relationships.filter((rel) => rel.fromId === id && (type ? rel.type === type : true));
  }

  async getContext(id: string, type?: Neo4jRelationshipType): Promise<GraphContext> {
    const node = await this.getNode(id);
    const outgoing = await this.getOutgoing(id, type);
    return {
      node,
      outgoing,
      relatedNodeIds: outgoing.map((rel) => rel.toId),
    };
  }

  async vectorSearch(embedding: number[], topK: number): Promise<VectorMatch[]> {
    const scored: VectorMatch[] = [];

    for (const [id, node] of this.nodes) {
      const candidate = node.properties.embedding;
      if (!Array.isArray(candidate)) {
        continue;
      }

      const vector = candidate.filter((value): value is number => typeof value === "number");
      if (vector.length === 0) {
        continue;
      }

      const size = Math.min(embedding.length, vector.length);
      if (size === 0) {
        continue;
      }

      let dot = 0;
      let normA = 0;
      let normB = 0;

      for (let i = 0; i < size; i += 1) {
        dot += embedding[i] * vector[i];
        normA += embedding[i] * embedding[i];
        normB += vector[i] * vector[i];
      }

      if (normA === 0 || normB === 0) {
        continue;
      }

      const score = dot / (Math.sqrt(normA) * Math.sqrt(normB));
      scored.push({ id, score });
    }

    return scored.sort((a, b) => b.score - a.score).slice(0, topK);
  }
}
