import { CognitiveGraphRepository } from "../neo4j/repositories/cognitiveGraphRepository.js";
import { CognitiveNode } from "../neo4j/schema/nodeTypes.js";
import { CognitiveRelationship } from "../neo4j/schema/relationshipTypes.js";
import { query } from "../../memory/jsonl/jsonlStore.js";
import { computeRecordHash } from "../../memory/jsonl/hash.js";
import { MemoryRecord } from "../../memory/jsonl/memoryRecord.js";
import { extractEntities } from "./entityExtraction.js";

export interface GraphProjectionSummary {
  nodeCount: number;
  relationshipCount: number;
  memoryCount: number;
}

export async function projectJsonlLedgerToGraph(
  filePath: string,
  repository: CognitiveGraphRepository,
): Promise<GraphProjectionSummary> {
  const records: MemoryRecord[] = [];
  for await (const record of query(filePath)) {
    records.push(record);
  }

  return projectMemoryRecordsToGraph(records, repository);
}

export async function projectMemoryRecordsToGraph(
  records: MemoryRecord[],
  repository: CognitiveGraphRepository,
): Promise<GraphProjectionSummary> {
  const hashToRecordId = new Map<string, string>();
  for (const record of records) {
    hashToRecordId.set(computeRecordHash(record), record.id);
  }

  const nodes = new Map<string, CognitiveNode>();
  const relationships = new Map<string, CognitiveRelationship>();

  for (const record of records) {
    const memoryNode: CognitiveNode = {
      id: record.id,
      type: "Memory",
      properties: {
        type: record.type,
        source: record.source,
        timestamp: record.timestamp,
        content: record.content,
        confidence: record.metadata.confidence,
        importance: record.metadata.importance,
      },
    };
    nodes.set(memoryNode.id, memoryNode);

    const agentId = `agent:${record.source}`;
    nodes.set(agentId, {
      id: agentId,
      type: "Agent",
      properties: {
        source: record.source,
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

    if (record.metadata.previous_hash) {
      const previousId = hashToRecordId.get(record.metadata.previous_hash);
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

  return {
    nodeCount: nodes.size,
    relationshipCount: relationships.size,
    memoryCount: records.length,
  };
}
