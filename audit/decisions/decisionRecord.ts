export interface DecisionRecord {
  decisionId: string;
  memories: string[];
  policies: string[];
  relationships: string[];
  timestamp: string;
  executionPath: string[];
}

export class AuditEngine {
  private readonly records: DecisionRecord[] = [];

  append(record: DecisionRecord): void {
    this.records.push(record);
  }

  list(): DecisionRecord[] {
    return [...this.records];
  }
}
