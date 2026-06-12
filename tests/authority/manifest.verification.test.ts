import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { computeAuthorityManifestHash, loadAuthorityKeyManifest } from "../../authority/signing/keyStore.js";

const cleanupTargets: string[] = [];

afterEach(async () => {
  while (cleanupTargets.length > 0) {
    const path = cleanupTargets.pop();
    if (path) {
      await rm(path, { recursive: true, force: true });
    }
  }
});

describe("Authority manifest verification", () => {
  it("fails to load when manifest hash mismatches", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qag-authority-manifest-"));
    cleanupTargets.push(dir);

    const manifestPath = join(dir, "authorityKeyManifest.json");
    const hashPath = join(dir, "authorityKey.hash");

    const manifest = {
      authorityId: "ava007-authority-v1",
      algorithm: "ed25519",
      publicKey: "pub-v1",
      createdAt: "2026-06-03T00:00:00.000Z",
      validFrom: "2026-06-03T00:00:00.000Z",
      status: "active",
    };

    const manifestContent = `${JSON.stringify(manifest, null, 2)}\n`;
    await writeFile(manifestPath, manifestContent, "utf8");
    await writeFile(hashPath, "deadbeef\n", "utf8");

    expect(() => loadAuthorityKeyManifest(manifestPath, hashPath)).toThrow(/hash verification failed/i);
  });

  it("loads manifest when hash matches", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qag-authority-manifest-ok-"));
    cleanupTargets.push(dir);

    const manifestPath = join(dir, "authorityKeyManifest.json");
    const hashPath = join(dir, "authorityKey.hash");

    const manifest = {
      authorityId: "ava007-authority-v1",
      algorithm: "ed25519",
      publicKey: "pub-v1",
      createdAt: "2026-06-03T00:00:00.000Z",
      validFrom: "2026-06-03T00:00:00.000Z",
      status: "active",
    };

    const manifestContent = `${JSON.stringify(manifest, null, 2)}\n`;
    await writeFile(manifestPath, manifestContent, "utf8");
    await writeFile(hashPath, `${computeAuthorityManifestHash(manifestContent)}\n`, "utf8");

    const loaded = loadAuthorityKeyManifest(manifestPath, hashPath);
    expect(loaded.authorityId).toBe("ava007-authority-v1");
  });
});
