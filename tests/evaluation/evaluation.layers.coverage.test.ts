import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runEvaluation } from "../../evaluation/runEvaluation.js";

const cleanupTargets: string[] = [];

afterEach(async () => {
  while (cleanupTargets.length > 0) {
    const target = cleanupTargets.pop();
    if (target) {
      await rm(target, { recursive: true, force: true });
    }
  }
});

describe("Evaluation layer coverage", () => {
  it("emits governance/provenance/judgment/safety/replay/signature/operational metrics", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qag-eval-layers-"));
    cleanupTargets.push(dir);

    const report = await runEvaluation(dir);

    expect(report.governance.total).toBeGreaterThan(0);
    expect(report.governance.covered).toBe(report.governance.total);

    expect(report.provenance.total).toBeGreaterThan(0);
    expect(report.provenance.continuous).toBe(report.provenance.total);

    expect(report.judgment.total).toBeGreaterThan(0);
    expect(report.safety.total).toBeGreaterThan(0);

    expect(report.replayIntegrity.total).toBeGreaterThan(0);
    expect(report.replayIntegrity.faithful).toBe(report.replayIntegrity.total);

    expect(report.signature.total).toBeGreaterThan(0);
    expect(report.signature.verified).toBe(report.signature.total);

    expect(report.operational.decisionTime.p50).toBeGreaterThanOrEqual(0);
    expect(report.operational.replayTime.p95).toBeGreaterThanOrEqual(0);

    const layerFiles = [
      "governance-results.jsonl",
      "provenance-results.jsonl",
      "judgment-results.jsonl",
      "safety-results.jsonl",
      "replay-integrity-results.jsonl",
      "signature-results.jsonl",
      "operational-results.jsonl",
    ];

    for (const file of layerFiles) {
      const filePath = join(dir, file);
      await expect(stat(filePath)).resolves.toBeDefined();
      const content = await readFile(filePath, "utf8");
      expect(content.trim().length).toBeGreaterThan(0);
    }
  });
});
