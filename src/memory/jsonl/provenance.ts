export interface DagPathProvenance {
  rootAtomId: string;
  rootVertexHash: string;
  terminalVertexHash: string;
  vertexHashes: string[];
  atomIds: string[];
  decisionId?: string;
}
