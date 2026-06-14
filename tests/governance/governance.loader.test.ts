import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadGovernanceSnapshot } from "../../governance/loader/governanceLoader.js";

const cleanupTargets: string[] = [];

afterEach(async () => {
  while (cleanupTargets.length > 0) {
    const path = cleanupTargets.pop();
    if (path) {
      await rm(path, { recursive: true, force: true });
    }
  }
});

describe("Governance runtime loader", () => {
  it("loads governance version and canonical authority order", async () => {
    const snapshot = await loadGovernanceSnapshot();

    expect(snapshot.governanceVersion).toMatch(/^\d+\.\d+(\.\d+)?$/);
    expect(snapshot.governanceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(snapshot.manifestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(snapshot.attestationHash).toMatch(/^[a-f0-9]{64}$/);
    expect(snapshot.authorityOrder).toEqual(["JSONL", "Tashi", "Neo4j", "GSAP", "Runtime"]);
    expect(snapshot.sourcePath.endsWith("governance/ava007")).toBe(true);
    expect(snapshot.manifestPath.endsWith("governance/manifest.json")).toBe(true);
    expect(snapshot.attestationPath.endsWith("governance/attestation.json")).toBe(true);
    expect(snapshot.loadedAt.length).toBeGreaterThan(0);
  });

  it("fails when manifest hash verification does not match", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qag-governance-loader-"));
    cleanupTargets.push(dir);

    const manifestPath = join(dir, "manifest.json");
    const manifestHashPath = join(dir, "manifest.hash");
    const attestationPath = join(dir, "attestation.json");
    const attestationHashPath = join(dir, "attestation.hash");

    await writeFile(
      manifestPath,
      JSON.stringify(
        {
          governanceVersion: "1.4",
          authorityOrder: ["JSONL", "Tashi", "Neo4j", "GSAP", "Runtime"],
          packageRoot: "ava007",
        },
        null,
        2,
      ),
      "utf8",
    );
    await writeFile(
      attestationPath,
      JSON.stringify(
        {
          governanceVersion: "1.4",
          manifestHash: "manifest-hash",
          governanceHash: "governance-hash",
          authorityOrder: ["JSONL", "Tashi", "Neo4j", "GSAP", "Runtime"],
          createdAt: "2026-06-03T00:00:00.000Z",
          issuer: "Ingeniosity",
        },
        null,
        2,
      ),
      "utf8",
    );
    await writeFile(manifestHashPath, "deadbeef", "utf8");
    await writeFile(attestationHashPath, "deadbeef", "utf8");

    await expect(loadGovernanceSnapshot(manifestPath, manifestHashPath, attestationPath, attestationHashPath)).rejects.toThrow(
      /manifest hash verification failed/i,
    );
  });

  it("fails when attestation hash verification does not match", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qag-governance-attestation-"));
    cleanupTargets.push(dir);

    const manifestPath = join(dir, "manifest.json");
    const manifestHashPath = join(dir, "manifest.hash");
    const attestationPath = join(dir, "attestation.json");
    const attestationHashPath = join(dir, "attestation.hash");
    const packageRoot = join(dir, "ava007");
    const packageFilePath = join(packageRoot, "seed.txt");

    await mkdir(packageRoot, { recursive: true });
    await writeFile(packageFilePath, "seed", "utf8");

    const manifestPayload = JSON.stringify(
      {
        governanceVersion: "1.4",
        authorityOrder: ["JSONL", "Tashi", "Neo4j", "GSAP", "Runtime"],
        packageRoot: "ava007",
      },
      null,
      2,
    );
    const manifestHash = createHash("sha256").update(manifestPayload).digest("hex");
    const fileHash = createHash("sha256").update("seed").digest("hex");
    const governanceHash = createHash("sha256").update(`seed.txt:${fileHash}\n`).digest("hex");

    await writeFile(
      manifestPath,
      manifestPayload,
      "utf8",
    );
    await writeFile(manifestHashPath, manifestHash, "utf8");
    await writeFile(
      attestationPath,
      JSON.stringify(
        {
          governanceVersion: "1.4",
          manifestHash,
          governanceHash,
          authorityOrder: ["JSONL", "Tashi", "Neo4j", "GSAP", "Runtime"],
          createdAt: "2026-06-03T00:00:00.000Z",
          issuer: "Ingeniosity",
        },
        null,
        2,
      ),
      "utf8",
    );
    await writeFile(attestationHashPath, "deadbeef", "utf8");

    await expect(loadGovernanceSnapshot(manifestPath, manifestHashPath, attestationPath, attestationHashPath)).rejects.toThrow(
      /attestation hash verification failed/i,
    );
  });
});
