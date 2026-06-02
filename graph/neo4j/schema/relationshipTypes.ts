export const RELATIONSHIP_TYPES = [
  "RELATED_TO",
  "INFLUENCED_BY",
  "GENERATED",
  "REFERENCES",
  "SUPPORTS",
  "CONTRADICTS",
] as const;

export type Neo4jRelationshipType = (typeof RELATIONSHIP_TYPES)[number];

export interface CognitiveRelationship {
  fromId: string;
  toId: string;
  type: Neo4jRelationshipType;
  properties?: Record<string, unknown>;
}
