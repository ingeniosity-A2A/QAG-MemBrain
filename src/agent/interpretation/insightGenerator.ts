import { InterpretationPattern } from "./patternDetection.js";
import { GraphSnapshot } from "../../memory/graph/reconstruction/graphHash.js";
import { MemoryRecord } from "../../memory/jsonl/memoryRecord.js";

export interface InterpretationInsight {
  insightId: string;
  statement: string;
  evidence: string[];
}

export interface InsightGenerationContext {
  records: MemoryRecord[];
  replayState: string[];
  graphSnapshot: GraphSnapshot;
}

export function generateInsights(
  context: InsightGenerationContext,
  patterns: InterpretationPattern[],
): InterpretationInsight[] {
  const insights: InterpretationInsight[] = [
    {
      insightId: "insight-replay-size",
      statement: `Replay reconstructs ${context.replayState.length} records from ${context.records.length} ledger entries.`,
      evidence: [...context.replayState],
    },
    {
      insightId: "insight-graph-size",
      statement: `Graph projection contains ${context.graphSnapshot.nodes.length} nodes and ${context.graphSnapshot.relationships.length} relationships.`,
      evidence: context.graphSnapshot.nodes.map((node) => node.id),
    },
  ];

  const policyPattern = patterns.find((pattern) => pattern.label === "policy_reference");
  if (policyPattern) {
    insights.push({
      insightId: "insight-policy",
      statement: "Policy references are discoverable from memory content and projectable into relationship truth.",
      evidence: policyPattern.evidence,
    });
  }

  const chainPattern = patterns.find((pattern) => pattern.label === "chain_integrity");
  if (chainPattern) {
    insights.push({
      insightId: "insight-chain",
      statement: "Ledger ordering supports deterministic reconstruction without mutating source memory.",
      evidence: chainPattern.evidence,
    });
  }

  return insights;
}
