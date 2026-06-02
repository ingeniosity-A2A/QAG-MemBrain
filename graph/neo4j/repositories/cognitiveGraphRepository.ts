import { CognitiveNode } from "../schema/nodeTypes.js";
import { CognitiveRelationship, Neo4jRelationshipType } from "../schema/relationshipTypes.js";

export interface CognitiveGraphRepository {
  upsertNode(node: CognitiveNode): Promise<void>;
  createRelationship(relationship: CognitiveRelationship): Promise<void>;
  getNode(id: string): Promise<CognitiveNode | null>;
  getOutgoing(id: string, type?: Neo4jRelationshipType): Promise<CognitiveRelationship[]>;
}

export class InMemoryCognitiveGraphRepository implements CognitiveGraphRepository {
  private readonly nodes = new Map<string, CognitiveNode>();
  private readonly relationships: CognitiveRelationship[] = [];

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
}
