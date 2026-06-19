import { GraphSnapshot, computeGraphHash } from "../graph/reconstruction/graphHash.js";
import { MemoryRecord } from "../memory/jsonl/memoryRecord.js";
import { InterpretationInsight } from "./insightGenerator.js";
import { InterpretationPattern } from "./patternDetection.js";

export interface MemoryReflection {
  readOnly: true;
  ledgerCount: number;
  replayCount: number;
  graphNodeCount: number;
  graphRelationshipCount: number;
  graphHash: string;
  observations: string[];
  patterns: InterpretationPattern[];
  insights: InterpretationInsight[];
}

export interface MemoryReflectionInput {
  records: MemoryRecord[];
  replayState: string[];
  graphSnapshot: GraphSnapshot;
  observations: string[];
  patterns: InterpretationPattern[];
  insights: InterpretationInsight[];
}

export function reflectMemory(input: MemoryReflectionInput): MemoryReflection {
  return {
    readOnly: true,
    ledgerCount: input.records.length,
    replayCount: input.replayState.length,
    graphNodeCount: input.graphSnapshot.nodes.length,
    graphRelationshipCount: input.graphSnapshot.relationships.length,
    graphHash: computeGraphHash(input.graphSnapshot),
    observations: [...input.observations],
    patterns: input.patterns.map((pattern) => ({ ...pattern, evidence: [...pattern.evidence] })),
    insights: input.insights.map((insight) => ({ ...insight, evidence: [...insight.evidence] })),
  };
}
