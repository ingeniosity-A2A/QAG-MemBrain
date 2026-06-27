import { CognitiveGraphRepository } from "./repositories/cognitiveGraphRepository.js";
import { CognitiveNode } from "./schema/nodeTypes.js";
import { CognitiveRelationship } from "./schema/relationshipTypes.js";
import { query, MemoryRecord } from "../memory/jsonl/index.js";
import { computeRecordHash } from "../memory/jsonl/hash.js";
import { extractEntities } from "./entityExtraction.js";
import { computeGraphHash, GraphSnapshot } from "./graphHash.js";

export interface GraphProjectionSummary {
  nodeCount: number;
  relationshipCount: number;
  memoryCount: number;
}

export interface GraphProjectionResult {
  summary: GraphProjectionSummary;
  snapshot: GraphSnapshot;
}

export async function projectJsonlLedgerToGraph(
  filePath: string,
  repository: CognitiveGraphRepository,
): Promise<GraphProjectionSummary> {
  const records: MemoryRecord[] = [];
  for await (const record of query(filePath)) {
    records.push(record);
  }

  const projected = await projectMemoryRecordsToGraph(records, repository);
  return projected.summary;
}

export async function projectMemoryRecordsToGraph(
  records: MemoryRecord[],
  repository: CognitiveGraphRepository,
): Promise<GraphProjectionResult> {
  const hashToRecordId = new Map<string, string>();
  for (const record of records) {
    hashToRecordId.set(computeRecordHash(record), record.id);
  }

  const nodes = new Map<string, CognitiveNode>();
  const relationships = new Map<string, CognitiveRelationship>();

  for (const record of records) {
    const recordSource = (record.metadata?.source as string) ?? "unknown";
    const memoryNode: CognitiveNode = {
      id: record.id,
      type: "Memory",
      properties: {
        type: record.type,
        source: recordSource,
        timestamp: record.timestamp,
        content: record.content,
        confidence: record.metadata?.confidence,
        importance: record.metadata?.importance,
      },
    };
    nodes.set(memoryNode.id, memoryNode);

    const agentId = `agent:${recordSource}`;
    nodes.set(agentId, {
      id: agentId,
      type: "Agent",
      properties: {
        source: recordSource,
      },
    });

    relationships.set(`${agentId}->${record.id}:GENERATED`, {
      fromId: agentId,
      toId: record.id,
      type: "GENERATED",
      properties: {
        timestamp: record.timestamp,
      },
    });

    if (record.metadata?.previous_hash) {
      const previousId = hashToRecordId.get(record.metadata.previous_hash as string);
      if (previousId) {
        relationships.set(`${previousId}->${record.id}:RELATED_TO`, {
          fromId: previousId,
          toId: record.id,
          type: "RELATED_TO",
          properties: {
            reason: "previous_hash",
          },
        });
      }
    }

    for (const entity of extractEntities(record)) {
      nodes.set(entity.id, {
        id: entity.id,
        type: entity.type,
        properties: {
          confidence: entity.confidence,
        },
      });

      relationships.set(`${record.id}->${entity.id}:REFERENCES`, {
        fromId: record.id,
        toId: entity.id,
        type: "REFERENCES",
        properties: {
          confidence: entity.confidence,
        },
      });

      if (entity.type === "Policy") {
        relationships.set(`${record.id}->${entity.id}:INFLUENCED_BY`, {
          fromId: record.id,
          toId: entity.id,
          type: "INFLUENCED_BY",
          properties: {
            reason: "entity_extraction",
          },
        });
      }
    }
  }

  for (const node of nodes.values()) {
    await repository.upsertNode(node);
  }

  for (const relationship of relationships.values()) {
    await repository.createRelationship(relationship);
  }

  const snapshot: GraphSnapshot = {
    nodes: [...nodes.values()],
    relationships: [...relationships.values()],
  };

  return {
    summary: {
      nodeCount: nodes.size,
      relationshipCount: relationships.size,
      memoryCount: records.length,
    },
    snapshot,
  };
}

export async function projectJsonlLedgerToGraphHash(
  filePath: string,
  repository: CognitiveGraphRepository,
): Promise<{ summary: GraphProjectionSummary; graphHash: string; snapshot: GraphSnapshot }> {
  const records: MemoryRecord[] = [];
  for await (const record of query(filePath)) {
    records.push(record);
  }

  const projected = await projectMemoryRecordsToGraph(records, repository);
  return {
    summary: projected.summary,
    graphHash: computeGraphHash(projected.snapshot),
    snapshot: projected.snapshot,
  };
}
