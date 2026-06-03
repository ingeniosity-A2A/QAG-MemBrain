import { AuthorityLayer } from "../replay/replayContract.js";

export interface ReplayRecordInput {
  replayId: string;
  decisionId: string;
  lineageId: string;
  status: "VERIFIED" | "FAILED";
  failureReasons: string[];
  authorityOrder: AuthorityLayer[];
  timestamp: string;
  startedAt: string;
  completedAt: string;
}

export interface ReplayRecord extends ReplayRecordInput {
  replayHash: string;
}