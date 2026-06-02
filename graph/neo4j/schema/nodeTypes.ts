export const NODE_TYPES = [
  "Memory",
  "Policy",
  "Agent",
  "Decision",
  "Session",
  "Document",
] as const;

export type Neo4jNodeType = (typeof NODE_TYPES)[number];

export interface CognitiveNode {
  id: string;
  type: Neo4jNodeType;
  properties: Record<string, unknown>;
}
