import { createHash } from "node:crypto";
import { CognitiveNode } from "./schema/nodeTypes.js";
import { CognitiveRelationship } from "./schema/relationshipTypes.js";

export interface GraphSnapshot {
  nodes: CognitiveNode[];
  relationships: CognitiveRelationship[];
}

export interface GraphEqualityResult {
  equal: boolean;
  leftHash: string;
  rightHash: string;
}

export function computeGraphHash(snapshot: GraphSnapshot): string {
  const canonical = canonicalGraphSnapshot(snapshot);
  return createHash("sha256").update(canonical).digest("hex");
}

export function verifyGraphEquality(left: GraphSnapshot, right: GraphSnapshot): GraphEqualityResult {
  const leftHash = computeGraphHash(left);
  const rightHash = computeGraphHash(right);
  return {
    equal: leftHash === rightHash,
    leftHash,
    rightHash,
  };
}

function canonicalGraphSnapshot(snapshot: GraphSnapshot): string {
  const canonicalNodes = [...snapshot.nodes]
    .map((node) => canonicalNode(node))
    .sort((a, b) => a.localeCompare(b));
  const canonicalRelationships = [...snapshot.relationships]
    .map((relationship) => canonicalRelationship(relationship))
    .sort((a, b) => a.localeCompare(b));

  return JSON.stringify({ nodes: canonicalNodes, relationships: canonicalRelationships });
}

function canonicalNode(node: CognitiveNode): string {
  return JSON.stringify({
    id: node.id,
    type: node.type,
    properties: stableObject(node.properties),
  });
}

function canonicalRelationship(relationship: CognitiveRelationship): string {
  return JSON.stringify({
    fromId: relationship.fromId,
    toId: relationship.toId,
    type: relationship.type,
    properties: relationship.properties ? stableObject(relationship.properties) : {},
  });
}

function stableObject(value: Record<string, unknown>): Record<string, unknown> {
  const sortedEntries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
  return sortedEntries.reduce<Record<string, unknown>>((accumulator, [key, entry]) => {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      accumulator[key] = stableObject(entry as Record<string, unknown>);
      return accumulator;
    }

    if (Array.isArray(entry)) {
      accumulator[key] = entry.map((item) =>
        item && typeof item === "object" && !Array.isArray(item) ? stableObject(item as Record<string, unknown>) : item,
      );
      return accumulator;
    }

    accumulator[key] = entry;
    return accumulator;
  }, {});
}
