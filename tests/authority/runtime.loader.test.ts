import { afterEach, describe, expect, it } from "vitest";
import { computeRuntimeHash, loadRuntimeSnapshot, resetRuntimeSnapshotForTests } from "../../authority/runtime/runtimeLoader.js";

afterEach(() => {
  resetRuntimeSnapshotForTests();
});

describe("Runtime identity loader", () => {
  it("computes runtime hash from deploymentHash + processId + hostname + startedAt", () => {
    const hash = computeRuntimeHash("dep-hash", 99, "host-a", "2026-06-03T00:00:00.000Z");
    const same = computeRuntimeHash("dep-hash", 99, "host-a", "2026-06-03T00:00:00.000Z");
    const changed = computeRuntimeHash("dep-hash", 100, "host-a", "2026-06-03T00:00:00.000Z");

    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).toBe(same);
    expect(hash).not.toBe(changed);
  });

  it("returns a stable startup snapshot for the running process", () => {
    const first = loadRuntimeSnapshot({
      runtimeVersion: "0.1.0",
      deploymentHash: "deployment-hash-a",
      buildHash: "build-hash-a",
    });

    const second = loadRuntimeSnapshot({
      runtimeVersion: "0.2.0",
      deploymentHash: "deployment-hash-b",
      buildHash: "build-hash-b",
    });

    expect(second.runtimeHash).toBe(first.runtimeHash);
    expect(second.startedAt).toBe(first.startedAt);
    expect(second.processId).toBe(first.processId);
  });
});
