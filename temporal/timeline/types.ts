export interface TimelineEvent {
  id: string;
  timestamp: string;
  decisionId?: string;
  patch: Record<string, unknown>;
}

export interface TimelineSnapshot {
  at: string;
  state: Record<string, unknown>;
}
