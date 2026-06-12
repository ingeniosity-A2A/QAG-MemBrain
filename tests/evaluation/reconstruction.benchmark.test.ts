import { describe, expect, it } from "vitest";
import { runReconstructionBenchmark } from "../../evaluation/benchmark/reconstructionBenchmark.js";

describe("Reconstruction benchmark", () => {
  it("emits scale results with authority and storage metrics", async () => {
    const report = await runReconstructionBenchmark({ scales: [10, 100] });

    expect(report.scales).toHaveLength(2);
    expect(report.scales[0].events).toBe(10);
    expect(report.scales[1].events).toBe(100);

    for (const entry of report.scales) {
      expect(entry.authorityIntegrityPercent).toBe(100);
      expect(entry.checkpointIntegrityPercent).toBe(100);
      expect(entry.merkleIntegrityPercent).toBe(100);
      expect(entry.reconstructMs).toBeGreaterThanOrEqual(0);
      expect(entry.verifyAuthorityMs).toBeGreaterThanOrEqual(0);
      expect(entry.verifyCheckpointMs).toBeGreaterThanOrEqual(0);
      expect(entry.verifyMerkleMs).toBeGreaterThanOrEqual(0);
      expect(entry.transitionBytes).toBeGreaterThan(0);
      expect(entry.signedTransitionBytes).toBeGreaterThan(entry.transitionBytes);
      expect(entry.stateOnlyBytes).toBeGreaterThan(0);
    }
  });
});
