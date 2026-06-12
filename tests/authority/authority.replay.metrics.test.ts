import { describe, expect, it } from "vitest";
import { AuthorityReplayMetrics } from "../../authority/service/authorityReplayMetrics.js";

describe("Authority replay metrics", () => {
  it("tracks aggregate verification outcomes", () => {
    const metrics = new AuthorityReplayMetrics();

    metrics.recordReplay(10, "VERIFIED", []);
    metrics.recordReplay(30, "FAILED", ["HASH_MISMATCH", "MISSING_MEMORY_REFERENCE"]);

    const snapshot = metrics.snapshot();
    expect(snapshot.totalReplays).toBe(2);
    expect(snapshot.verifiedReplays).toBe(1);
    expect(snapshot.failedReplays).toBe(1);
    expect(snapshot.hashMismatchCount).toBe(1);
    expect(snapshot.missingMemoryReferenceCount).toBe(1);
    expect(snapshot.averageReplayTimeMs).toBe(20);
  });
});