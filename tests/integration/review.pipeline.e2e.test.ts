import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { append } from "../../memory/jsonl/jsonlStore.js";
import { MemoryRecord } from "../../memory/jsonl/memoryRecord.js";
import { computeRecordHash } from "../../memory/jsonl/hash.js";
import { signRecord, verifyRecord } from "../../trust/verification/signerService.js";
import { InMemoryDIDRegistry } from "../../trust/did/didRegistry.js";
import { InMemoryCognitiveGraphRepository } from "../../graph/neo4j/repositories/cognitiveGraphRepository.js";
import { interpretLedger } from "../../interpretation/lens.js";
import { reviewProposal } from "../../review/proposalReview.js";
import { commitAcceptedProposal } from "../../review/proposalDecision.js";
import { createProposalAudit } from "../../review/proposalAudit.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("EPIC-007 observation review pipeline", () => {
  it("reviews interpretation, commits accepted proposals, and audits every decision", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qag-review-pipeline-"));
    cleanup.push(dir);
    const ledgerPath = join(dir, "ledger.jsonl");

    const pair = generateKeyPairSync("ed25519");
    const privateKeyPem = pair.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    const publicKeyPem = pair.publicKey.export({ format: "pem", type: "spki" }).toString();

    const didRegistry = new InMemoryDIDRegistry();
    const did = didRegistry.createDID({ id: "did:ava:review-test", algorithm: "ed25519", publicKeyPem });

    const records: MemoryRecord[] = [
      {
        id: "r-1",
        type: "event",
        source: "sensor:s25",
        timestamp: "2026-06-03T00:00:00.000Z",
        content: "entity:quote-812 policy:approval-policy-v4",
        metadata: {
          confidence: 0.95,
          importance: "high",
        },
      },
      {
        id: "r-2",
        type: "event",
        source: "sensor:s26",
        timestamp: "2026-06-03T00:00:01.000Z",
        content: "entity:quote-812 session:assembly-shift-a",
        metadata: {
          confidence: 0.9,
          importance: "medium",
          previous_hash: undefined,
        },
      },
    ];

    const signedRecords: MemoryRecord[] = [];
    for (const record of records) {
      const previous = signedRecords.at(-1);
      const prepared: MemoryRecord = {
        ...record,
        metadata: {
          ...record.metadata,
          previous_hash: previous ? computeRecordHash(previous) : undefined,
        },
      };

      const signed = signRecord(prepared, privateKeyPem);
      signedRecords.push(signed);
      await append(ledgerPath, signed, {
        signatureVerifier: (candidate) => verifyRecord(candidate, didRegistry.activeKeys(did.id)[0].publicKeyPem),
      });
    }

    const before = await readFile(ledgerPath, "utf8");
    const reflection = await interpretLedger(ledgerPath, {
      repositoryFactory: () => new InMemoryCognitiveGraphRepository(),
    });
    const proposal = {
      type: "observation" as const,
      source: "rev_ike_lens" as const,
      derived_from: [...reflection.insights.map((item) => item.insightId), ...reflection.patterns.map((pattern) => pattern.patternId)],
      insight: reflection.insights[0]?.statement ?? "No insight available",
      confidence: 0.91,
      observationCount: reflection.observations.length,
      graphHash: reflection.graphHash,
    };

    const reviewDecision = reviewProposal(proposal, {
      minimumConfidence: 0.8,
      requiredEvidenceCount: 2,
    });

    const audit = createProposalAudit(proposal, reviewDecision);
    expect(audit.outcome).toBe("accept");

    const commitResult = await commitAcceptedProposal(proposal, reviewDecision, {
      ledgerPath,
      privateKeyPem,
      sourceDid: did.id,
    });

    const after = await readFile(ledgerPath, "utf8");
    expect(before).not.toBe(after);
    expect(reviewDecision.outcome).toBe("accept");
    expect(commitResult.accepted).toBe(true);
    expect(commitResult.memoryRecord?.source).toBe(did.id);
    expect(commitResult.memoryRecord?.content).toContain("Replay reconstructs");
    expect(commitResult.memoryRecord?.metadata.signature).toBeDefined();
    expect(commitResult.memoryRecord?.metadata.previous_hash).toBeDefined();
  });

  it("rejects weak proposals and leaves ledger unchanged", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qag-review-pipeline-"));
    cleanup.push(dir);
    const ledgerPath = join(dir, "ledger.jsonl");

    const pair = generateKeyPairSync("ed25519");
    const privateKeyPem = pair.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    const publicKeyPem = pair.publicKey.export({ format: "pem", type: "spki" }).toString();

    const didRegistry = new InMemoryDIDRegistry();
    const did = didRegistry.createDID({ id: "did:ava:review-test-2", algorithm: "ed25519", publicKeyPem });

    const weakProposal = {
      type: "observation" as const,
      source: "rev_ike_lens" as const,
      derived_from: ["only-one"],
      insight: "Low confidence observation",
      confidence: 0.2,
      observationCount: 1,
      graphHash: "0".repeat(64),
    };

    const reviewDecision = reviewProposal(weakProposal, {
      minimumConfidence: 0.8,
      requiredEvidenceCount: 2,
    });

    const audit = createProposalAudit(weakProposal, reviewDecision);
    expect(audit.outcome).toBe("reject");

    const commitResult = await commitAcceptedProposal(weakProposal, reviewDecision, {
      ledgerPath,
      privateKeyPem,
      sourceDid: did.id,
    });

    const contents = await readFile(ledgerPath, "utf8");
    expect(contents).toBe("");
    expect(reviewDecision.outcome).toBe("reject");
    expect(commitResult.accepted).toBe(false);
    expect(commitResult.memoryRecord).toBeUndefined();
  });
});
