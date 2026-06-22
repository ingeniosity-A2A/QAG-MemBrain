import { GraphSnapshot } from "../graph/reconstruction/graphHash.js";
import { MemoryRecord } from "../memory/jsonl/memoryRecord.js";

export interface InterpretationPattern {
  patternId: string;
  label: string;
  evidence: string[];
}

export interface PatternDetectionContext {
  records: MemoryRecord[];
  replayState: string[];
  graphSnapshot: GraphSnapshot;
}

export function detectPatterns(context: PatternDetectionContext): InterpretationPattern[] {
  const patterns: InterpretationPattern[] = [];

  if (context.records.length > 1 && context.records.every((record) => typeof record.metadata.previous_hash !== "undefined" || record === context.records[0])) {
    patterns.push({
      patternId: "chain-integrity",
      label: "chain_integrity",
      evidence: context.records.map((record) => record.id),
    });
  }

  if (context.graphSnapshot.relationships.some((relationship: any) => relationship.type === "RELATED_TO")) {
    patterns.push({
      patternId: "graph-replay-alignment",
      label: "graph_replay_alignment",
      evidence: context.graphSnapshot.relationships
        .filter((relationship: any) => relationship.type === "RELATED_TO")
        .map((relationship: any) => `${relationship.fromId}->${relationship.toId}`),
    });
  }

  if (context.graphSnapshot.nodes.some((node: any) => node.type === "Policy")) {
    patterns.push({
      patternId: "policy-reference",
      label: "policy_reference",
      evidence: context.graphSnapshot.nodes.filter((node: any) => node.type === "Policy").map((node: any) => node.id),
    });
  }

  if (context.replayState.length === context.records.length && context.records.length > 0) {
    patterns.push({
      patternId: "replay-consistency",
      label: "replay_consistency",
      evidence: [...context.replayState],
    });
  }

  return patterns;
}
