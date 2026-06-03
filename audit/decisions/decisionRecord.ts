export interface DecisionRecord {
  decisionId: string;
  memories: string[];
  policies: string[];
  relationships: string[];
  timestamp: string;
  executionPath: string[];
  lineageId?: string;
  decisionHash?: string;
}

export class AuditEngine {
  private readonly records: DecisionRecord[] = [];

  record(record: DecisionRecord): void {
    this.records.push(record);
  }

  append(record: DecisionRecord): void {
    this.record(record);
  }

  list(): DecisionRecord[] {
    return [...this.records];
  }
}
