import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadDeploymentSnapshot } from "../../authority/deployment/deploymentLoader.js";

const cleanupTargets: string[] = [];

afterEach(async () => {
  while (cleanupTargets.length > 0) {
    const path = cleanupTargets.pop();
    if (path) {
      await rm(path, { recursive: true, force: true });
    }
  }
});

describe("Deployment provenance loader", () => {
  it("loads deployment identity from manifest, hash, and build linkage", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qag-deployment-loader-"));
    cleanupTargets.push(dir);

    const manifestPath = join(dir, "deploymentManifest.json");
    const hashPath = join(dir, "deployment.hash");
    const manifestRaw = JSON.stringify(
      {
        deploymentVersion: "1.0.0",
        environment: "development",
        buildHash: "build-hash-test",
        releaseId: "release-test",
        containerHash: "container-hash-test",
        deployedAt: "2026-06-03T00:00:00.000Z",
      },
      null,
      2,
    );

    await writeFile(manifestPath, manifestRaw, "utf8");
    await writeFile(hashPath, createHash("sha256").update(manifestRaw).digest("hex"), "utf8");

    const snapshot = loadDeploymentSnapshot("build-hash-test", manifestPath, hashPath);

    expect(snapshot.deploymentVersion).toBe("1.0.0");
    expect(snapshot.deploymentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(snapshot.releaseId).toBe("release-test");
    expect(snapshot.environment).toBe("development");
    expect(snapshot.buildHash).toBe("build-hash-test");
    expect(snapshot.containerHash).toBe("container-hash-test");
    expect(snapshot.deployedAt).toBe("2026-06-03T00:00:00.000Z");
  });

  it("fails when deployment manifest build linkage does not match", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qag-deployment-loader-fail-"));
    cleanupTargets.push(dir);

    const manifestPath = join(dir, "deploymentManifest.json");
    const hashPath = join(dir, "deployment.hash");
    const manifestRaw = JSON.stringify(
      {
        deploymentVersion: "1.0.0",
        environment: "development",
        buildHash: "build-hash-right",
        releaseId: "release-test",
        containerHash: "container-hash-test",
        deployedAt: "2026-06-03T00:00:00.000Z",
      },
      null,
      2,
    );

    await writeFile(manifestPath, manifestRaw, "utf8");
    await writeFile(hashPath, createHash("sha256").update(manifestRaw).digest("hex"), "utf8");

    expect(() => loadDeploymentSnapshot("build-hash-wrong", manifestPath, hashPath)).toThrow(
      /deployment manifest buildHash does not match build provenance hash/i,
    );
  });
});