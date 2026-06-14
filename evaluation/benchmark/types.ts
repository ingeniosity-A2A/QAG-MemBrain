export interface ReconstructionBenchmarkScaleResult {
  events: number;
  reconstructMs: number;
  verifyAuthorityMs: number;
  verifyCheckpointMs: number;
  verifyMerkleMs: number;
  explainLineageMs: number;
  totalMs: number;
  totalCheckpointMs: number;
  totalMerkleMs: number;
  checkpointInterval: number;
  authorityIntegrityPercent: number;
  checkpointIntegrityPercent: number;
  merkleIntegrityPercent: number;
  explainabilityScore: number;
  transitionBytes: number;
  signedTransitionBytes: number;
  stateOnlyBytes: number;
  storageReductionPercent: number;
  faissLikeLookupMs: number;
  openSearchLikeLookupMs: number;
}

export interface ReconstructionBenchmarkReport {
  generatedAt: string;
  scales: ReconstructionBenchmarkScaleResult[];
  notes: string[];
}
