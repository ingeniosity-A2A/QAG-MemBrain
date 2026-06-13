import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { append } from "../../memory/jsonl/jsonlStore.js";
import { MemoryRecord } from "../../memory/jsonl/memoryRecord.js";
import { canonicalRecordForSigning } from "../../memory/jsonl/hash.js";
import { signRecord } from "../trust/verification/signerService.js";
import { InterpretationObservationProposal } from "../interpretation/observationProposal.js";
import { ProposalReviewDecision } from "./proposalReview.js";

export interface ProposalDecisionResult {
  accepted: boolean;
  memoryRecord?: MemoryRecord;
  decisionId: string;
}

export interface CommitAcceptedProposalOptions {
  ledgerPath: string;
  privateKeyPem: string;
  sourceDid: string;
  timestamp?: string;
}

export async function commitAcceptedProposal(
  proposal: InterpretationObservationProposal,
  reviewDecision: ProposalReviewDecision,
  options: CommitAcceptedProposalOptions,
): Promise<ProposalDecisionResult> {
  await ensureLedgerFile(options.ledgerPath);
  const decisionId = randomUUID();

  if (reviewDecision.outcome !== "accept") {
    return {
      accepted: false,
      decisionId,
    };
  }

  const timestamp = options.timestamp ?? new Date().toISOString();
  const record: MemoryRecord = {
    id: `obs-${decisionId}`,
    type: proposal.type,
    source: options.sourceDid,
    timestamp,
    content: proposal.insight,
    metadata: {
      confidence: proposal.confidence,
      importance: "medium",
      previous_hash: await lastRecordHash(options.ledgerPath),
      signature: undefined,
    },
  };

  const signed = signRecord(record, options.privateKeyPem);
  await append(options.ledgerPath, signed, {
    signatureVerifier: (candidate) =>
      candidate.metadata.signature === signed.metadata.signature &&
      hashProposalCandidate(candidate) === hashProposalCandidate(signed),
  });

  return {
    accepted: true,
    memoryRecord: signed,
    decisionId,
  };
}

async function lastRecordHash(filePath: string): Promise<string | undefined> {
  const contents = await readFile(filePath, "utf8").catch(() => "");
  const lines = contents.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return undefined;
  }

  const last = JSON.parse(lines[lines.length - 1]) as MemoryRecord;
  return createHash("sha256").update(canonicalRecordForSigning(last)).digest("hex");
}

function hashProposalCandidate(record: MemoryRecord): string {
  return createHash("sha256").update(canonicalRecordForSigning(record)).digest("hex");
}

async function ensureLedgerFile(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  try {
    await stat(filePath);
  } catch {
    await writeFile(filePath, "", "utf8");
  }
}
