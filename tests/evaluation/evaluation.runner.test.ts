import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runEvaluation } from "../../evaluation/runEvaluation.js";
import { verifyEvaluationSignature } from "../../evaluation/shared/signing.js";

const cleanupTargets: string[] = [];

afterEach(async () => {
  while (cleanupTargets.length > 0) {
    const path = cleanupTargets.pop();
    if (path) {
      await rm(path, { recursive: true, force: true });
    }
  }
});

describe("Evaluation runner", () => {
  it("generates signed report and layer artifacts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qag-evaluation-"));
    cleanupTargets.push(dir);

    const report = await runEvaluation(dir);

    expect(report.capability.totalCases).toBe(300);
    expect(report.reliability.totalRuns).toBe(10);
    expect(report.signature.signatureVerificationRate).toBe(100);

    await expect(stat(join(dir, "capability-results.jsonl"))).resolves.toBeDefined();
    await expect(stat(join(dir, "reliability-results.jsonl"))).resolves.toBeDefined();
    await expect(stat(join(dir, "evaluation-report.json"))).resolves.toBeDefined();
    await expect(stat(join(dir, "evaluation-report.hash"))).resolves.toBeDefined();
    await expect(stat(join(dir, "evaluation-report.signature"))).resolves.toBeDefined();

    const reportHash = (await readFile(join(dir, "evaluation-report.hash"), "utf8")).trim();
    expect(reportHash).toMatch(/^[a-f0-9]{64}$/);

    const signature = JSON.parse(await readFile(join(dir, "evaluation-report.signature"), "utf8")) as {
      algorithm: "ed25519";
      authorityId: string;
      signerId: string;
      signedAt: string;
      hash: string;
      signature: string;
      publicKey?: string;
    };

    expect(signature.authorityId.length).toBeGreaterThan(0);
    expect(signature.hash).toBe(reportHash);
    expect(verifyEvaluationSignature(signature)).toBe(true);
  });
});
