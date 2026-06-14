import { ResolutionOutcome } from "../../policy/precedence/policyPrecedence.js";

export type AuthorityLayer = "JSONL" | "Tashi" | "Neo4j" | "GSAP" | "Runtime";

export const CANONICAL_AUTHORITY_ORDER: AuthorityLayer[] = ["JSONL", "Tashi", "Neo4j", "GSAP", "Runtime"];

export interface AuthorityReplayRecord {
  decisionId: string;
  lineageId: string;
  authorityOrder: AuthorityLayer[];
  memoryReferences: string[];
  graphReferences: string[];
  timelineReferences: string[];
  policyReferences: string[];
  finalPolicyOutcome: ResolutionOutcome;
  storedDecisionHash: string;
  reconstructedDecisionHash: string;
  hashMatch: boolean;
  policyMatch: boolean;
  referencesValid: boolean;
  reconstructionMatch: boolean;
  timestamp: string;
}
