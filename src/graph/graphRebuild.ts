import { CognitiveGraphRepository, InMemoryCognitiveGraphRepository } from "./repositories/cognitiveGraphRepository.js";
import { projectJsonlLedgerToGraphHash } from "./jsonlGraphProjection.js";
import { GraphEqualityResult, GraphSnapshot, verifyGraphEquality } from "./graphHash.js";

export interface GraphRebuildVerificationResult extends GraphEqualityResult {
  valid: boolean;
  firstSummary: {
    nodeCount: number;
    relationshipCount: number;
    memoryCount: number;
  };
  secondSummary: {
    nodeCount: number;
    relationshipCount: number;
    memoryCount: number;
  };
}

export async function verifyGraphRebuild(
  filePath: string,
  repositoryFactory: () => CognitiveGraphRepository = () => new InMemoryCognitiveGraphRepository(),
): Promise<GraphRebuildVerificationResult> {
  const firstRepository = repositoryFactory();
  const first = await projectJsonlLedgerToGraphHash(filePath, firstRepository);

  const secondRepository = repositoryFactory();
  const second = await projectJsonlLedgerToGraphHash(filePath, secondRepository);

  const equality = verifyGraphEquality(first.snapshot, second.snapshot);
  return {
    equal: equality.equal,
    valid: equality.equal,
    leftHash: equality.leftHash,
    rightHash: equality.rightHash,
    firstSummary: first.summary,
    secondSummary: second.summary,
  };
}

export function snapshotsEqual(left: GraphSnapshot, right: GraphSnapshot): GraphEqualityResult {
  return verifyGraphEquality(left, right);
}
