export interface DagPathProvenance {
  rootAtomId: string;
  rootVertexHash: string;
  terminalVertexHash: string;
  vertexHashes: string[];
  atomIds: string[];
  decisionId?: string;
}

export function isDagPathProvenance(value: unknown): value is DagPathProvenance {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<DagPathProvenance>;
  return (
    typeof candidate.rootAtomId === "string" &&
    candidate.rootAtomId.length > 0 &&
    typeof candidate.rootVertexHash === "string" &&
    candidate.rootVertexHash.length > 0 &&
    typeof candidate.terminalVertexHash === "string" &&
    candidate.terminalVertexHash.length > 0 &&
    Array.isArray(candidate.vertexHashes) &&
    candidate.vertexHashes.every((hash) => typeof hash === "string" && hash.length > 0) &&
    Array.isArray(candidate.atomIds) &&
    candidate.atomIds.every((atomId) => typeof atomId === "string" && atomId.length > 0) &&
    (typeof candidate.decisionId === "undefined" || typeof candidate.decisionId === "string")
  );
}

export function assertDagPathProvenance(value: unknown): asserts value is DagPathProvenance {
  if (!isDagPathProvenance(value)) {
    throw new Error("Invalid DAG path provenance");
  }
}
