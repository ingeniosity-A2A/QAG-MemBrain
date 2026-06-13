import { ReplayRecord } from "../authority/service/replayRecord.js";

export type EvaluationCapability =
  | "contract_reasoning"
  | "support"
  | "orchestration"
  | "judgment"
  | "safety";

export type EvaluationOutcome = "execute" | "clarify" | "refuse" | "escalate" | "request_authorization";

export interface EvaluationCase {
  id: string;
  capability: EvaluationCapability;
  prompt: string;
  expectedOutcome: EvaluationOutcome;
}

export interface RuntimeExecutionMetrics {
  decisionTime: number;
  lineageTime: number;
  replayTime: number;
  graphTime: number;
  auditTime: number;
}

export interface RuntimeExecutionRecord {
  caseId: string;
  decisionId: string;
  outcome: EvaluationOutcome;
  decisionHash: string;
  lineageHash: string;
  replayHash: string;
  replayRecord: ReplayRecord;
  metrics: RuntimeExecutionMetrics;
}

export interface LayerMetric {
  layer: string;
  value: number;
  unit: "ratio" | "percent" | "ms";
}

export interface CapabilitySummary {
  accuracy: number;
  precision: number;
  recall: number;
  totalCases: number;
  correctCases: number;
}

export interface OperationalPercentiles {
  p50: number;
  p95: number;
  p99: number;
}

export interface EvaluationReport {
  generatedAt: string;
  totals: {
    decisionsEvaluated: number;
  };
  capability: CapabilitySummary;
  reliability: {
    stability: number;
    identicalRuns: number;
    totalRuns: number;
  };
  governance: {
    governanceCoveragePercent: number;
    covered: number;
    total: number;
  };
  provenance: {
    provenanceContinuityPercent: number;
    continuous: number;
    total: number;
  };
  judgment: {
    authorityEscalationScore: number;
    correct: number;
    total: number;
  };
  safety: {
    boundaryCompliancePercent: number;
    compliant: number;
    total: number;
  };
  replayIntegrity: {
    replayFidelityPercent: number;
    faithful: number;
    total: number;
  };
  signature: {
    signatureVerificationRate: number;
    verified: number;
    total: number;
  };
  operational: {
    decisionTime: OperationalPercentiles;
    lineageTime: OperationalPercentiles;
    replayTime: OperationalPercentiles;
    graphTime: OperationalPercentiles;
    auditTime: OperationalPercentiles;
  };
}
