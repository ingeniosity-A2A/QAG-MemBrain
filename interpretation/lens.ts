import { query } from "../memory/jsonl/jsonlStore.js";
import { MemoryRecord } from "../memory/jsonl/memoryRecord.js";
import { replayFromGenesis } from "../memory/replay/replayEngine.js";
import { InMemoryCognitiveGraphRepository } from "../graph/neo4j/repositories/cognitiveGraphRepository.js";
import { projectJsonlLedgerToGraphHash } from "../graph/reconstruction/jsonlGraphProjection.js";
import { detectPatterns } from "./patternDetection.js";
import { generateInsights } from "./insightGenerator.js";
import { reflectMemory, MemoryReflection } from "./memoryReflection.js";

export interface InterpretLedgerOptions {
  repositoryFactory?: () => InMemoryCognitiveGraphRepository;
}

export async function interpretLedger(
  filePath: string,
  options: InterpretLedgerOptions = {},
): Promise<MemoryReflection> {
  const records = await readRecords(filePath);
  const replayed = await replayFromGenesis(filePath, [] as string[], (state, record) => [...state, record.id]);
  const repository = options.repositoryFactory?.() ?? new InMemoryCognitiveGraphRepository();
  const graph = await projectJsonlLedgerToGraphHash(filePath, repository);

  const observations = [
    `Ledger contains ${records.length} records.`,
    `Replay reconstructs ${replayed.state.length} record ids.`,
    `Graph projection hash ${graph.graphHash}.`,
  ];

  const patterns = detectPatterns({
    records,
    replayState: replayed.state,
    graphSnapshot: graph.snapshot,
  });

  const insights = generateInsights(
    {
      records,
      replayState: replayed.state,
      graphSnapshot: graph.snapshot,
    },
    patterns,
  );

  return reflectMemory({
    records,
    replayState: replayed.state,
    graphSnapshot: graph.snapshot,
    observations,
    patterns,
    insights,
  });
}

async function readRecords(filePath: string): Promise<MemoryRecord[]> {
  const records: MemoryRecord[] = [];
  for await (const record of query(filePath)) {
    records.push(record);
  }

  return records;
}
