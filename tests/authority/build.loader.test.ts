import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadBuildSnapshot } from "../../authority/build/buildLoader.js";

const cleanupTargets: string[] = [];

afterEach(async () => {
  while (cleanupTargets.length > 0) {
    const path = cleanupTargets.pop();
    if (path) {
      await rm(path, { recursive: true, force: true });
    }
  }
});

describe("Build provenance loader", () => {
  it("loads build identity from manifest and verified hash", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qag-build-loader-"));
    cleanupTargets.push(dir);

    const manifestPath = join(dir, "buildManifest.json");
    const hashPath = join(dir, "build.hash");
    const packagePath = join(dir, "package.json");

    const manifestRaw = JSON.stringify(
      {
        runtimeVersion: "0.1.0",
        gitCommit: "5e300b0d9aa609a973e25420a884e30af88b070a",
        buildTimestamp: "2026-06-03T00:00:00.000Z",
        worktreeDirty: true,
      },
      null,
      2,
    );

    await writeFile(manifestPath, manifestRaw, "utf8");
    await writeFile(hashPath, createHash("sha256").update(manifestRaw).digest("hex"), "utf8");
    await writeFile(packagePath, JSON.stringify({ version: "0.1.0" }, null, 2), "utf8");

    const snapshot = loadBuildSnapshot(manifestPath, hashPath, packagePath);

    expect(snapshot.runtimeVersion).toBe("0.1.0");
    expect(snapshot.gitCommit).toBe("5e300b0d9aa609a973e25420a884e30af88b070a");
    expect(snapshot.buildHash).toMatch(/^[a-f0-9]{64}$/);
    expect(snapshot.buildTimestamp).toBe("2026-06-03T00:00:00.000Z");
    expect(snapshot.worktreeDirty).toBe(true);
  });

  it("fails when build manifest hash verification does not match", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qag-build-loader-fail-"));
    cleanupTargets.push(dir);

    const manifestPath = join(dir, "buildManifest.json");
    const hashPath = join(dir, "build.hash");
    const packagePath = join(dir, "package.json");

    await writeFile(
      manifestPath,
      JSON.stringify(
        {
          runtimeVersion: "0.1.0",
          gitCommit: "5e300b0d9aa609a973e25420a884e30af88b070a",
          buildTimestamp: "2026-06-03T00:00:00.000Z",
          worktreeDirty: true,
        },
        null,
        2,
      ),
      "utf8",
    );
    await writeFile(hashPath, "deadbeef", "utf8");
    await writeFile(packagePath, JSON.stringify({ version: "0.1.0" }, null, 2), "utf8");

    expect(() => loadBuildSnapshot(manifestPath, hashPath, packagePath)).toThrow(/build manifest hash verification failed/i);
  });
});