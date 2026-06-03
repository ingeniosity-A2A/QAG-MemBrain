export interface ReplayRecord {
  replayId: string;
  decisionId: string;
  lineageId: string;
  status: "VERIFIED" | "FAILED";
  failures: string[];
  startedAt: string;
  completedAt: string;
}