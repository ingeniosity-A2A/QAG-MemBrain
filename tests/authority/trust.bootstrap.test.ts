import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadAuthorityKeyManifest, loadTrustedAuthorities } from "../../authority/signing/keyStore.js";
import { bootstrapAuthorityTrustRoot } from "../../authority/signing/trustBootstrap.js";

const cleanupTargets: string[] = [];

afterEach(async () => {
  while (cleanupTargets.length > 0) {
    const path = cleanupTargets.pop();
    if (path) {
      await rm(path, { recursive: true, force: true });
    }
  }
});

describe("Authority trust bootstrap", () => {
  it("generates non-empty public keys, persists manifest hash, and sets active authority", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qag-trust-bootstrap-"));
    cleanupTargets.push(dir);

    const manifestPath = join(dir, "authorityKeyManifest.json");
    const hashPath = join(dir, "authorityKey.hash");
    const trustedPath = join(dir, "trustedAuthorities.json");
    const privateKeyPath = join(dir, "authoritySigner.private.pem");

    const result = bootstrapAuthorityTrustRoot(
      [
        {
          authorityId: "ava007-authority-v1",
          activatedAt: "2026-06-03T00:00:00.000Z",
          expiresAt: "2026-07-01T00:00:00.000Z",
        },
        {
          authorityId: "ava007-authority-v2",
          activatedAt: "2026-07-01T00:00:00.000Z",
        },
      ],
      {
        privateKeyPath,
        manifestPath,
        manifestHashPath: hashPath,
        trustedAuthoritiesPath: trustedPath,
      },
    );

    expect(result.manifest.authorityId).toBe("ava007-authority-v2");
    expect(result.manifest.publicKey.length).toBeGreaterThan(0);
    expect(result.trustedAuthorities.authorities).toHaveLength(2);

    const loadedManifest = loadAuthorityKeyManifest(manifestPath, hashPath);
    const loadedTrusted = loadTrustedAuthorities(trustedPath);

    expect(loadedManifest.authorityId).toBe("ava007-authority-v2");
    expect(loadedManifest.publicKey.length).toBeGreaterThan(0);
    expect(loadedTrusted.authorities.every((entry) => entry.publicKey.length > 0)).toBe(true);

    const persistedPrivateKey = await readFile(privateKeyPath, "utf8");
    expect(persistedPrivateKey.includes("BEGIN PRIVATE KEY")).toBe(true);
  });
});
