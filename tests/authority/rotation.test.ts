import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { rotateAuthorityKey, rotateAuthorityKeyInMemory } from "../../authority/signing/keyRotation.js";
import { AuthorityKeyManifest, TrustedAuthoritiesDocument, persistAuthorityKeyManifest, persistTrustedAuthorities } from "../../authority/signing/keyStore.js";

const cleanupTargets: string[] = [];

afterEach(async () => {
  while (cleanupTargets.length > 0) {
    const path = cleanupTargets.pop();
    if (path) {
      await rm(path, { recursive: true, force: true });
    }
  }
});

describe("Authority key rotation", () => {
  it("retires previous key, activates replacement, and emits ledger metadata", () => {
    const manifest: AuthorityKeyManifest = {
      authorityId: "ava007-authority-v1",
      algorithm: "ed25519",
      publicKey: "pub-v1",
      createdAt: "2026-06-03T00:00:00.000Z",
      validFrom: "2026-06-03T00:00:00.000Z",
      status: "active",
    };

    const trusted: TrustedAuthoritiesDocument = {
      updatedAt: "2026-06-03T00:00:00.000Z",
      authorities: [{ ...manifest }],
    };

    const rotated = rotateAuthorityKeyInMemory(manifest, trusted, {
      authorityId: "ava007-authority-v2",
      publicKey: "pub-v2",
      reason: "scheduled-rotation",
      rotatedAt: "2026-07-01T00:00:00.000Z",
    });

    expect(rotated.manifest.authorityId).toBe("ava007-authority-v2");
    expect(rotated.manifest.validFrom).toBe("2026-07-01T00:00:00.000Z");
    expect(rotated.ledgerRecord.replacedAuthorityId).toBe("ava007-authority-v1");
    expect(rotated.ledgerRecord.replacementAuthorityId).toBe("ava007-authority-v2");
    expect(rotated.ledgerRecord.reason).toBe("scheduled-rotation");

    const retiredV1 = rotated.trustedAuthorities.authorities.find((authority) => authority.authorityId === "ava007-authority-v1");
    expect(retiredV1?.status).toBe("retired");
    expect(retiredV1?.validUntil).toBe("2026-07-01T00:00:00.000Z");
  });

  it("persists rotation audit trail in authorityRotationLedger.jsonl", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qag-rotation-ledger-"));
    cleanupTargets.push(dir);

    const manifestPath = join(dir, "authorityKeyManifest.json");
    const hashPath = join(dir, "authorityKey.hash");
    const trustedPath = join(dir, "trustedAuthorities.json");
    const ledgerPath = join(dir, "authorityRotationLedger.jsonl");

    const manifest: AuthorityKeyManifest = {
      authorityId: "ava007-authority-v1",
      algorithm: "ed25519",
      publicKey: "pub-v1",
      createdAt: "2026-06-03T00:00:00.000Z",
      validFrom: "2026-06-03T00:00:00.000Z",
      status: "active",
    };

    const trusted: TrustedAuthoritiesDocument = {
      updatedAt: "2026-06-03T00:00:00.000Z",
      authorities: [{ ...manifest }],
    };

    persistAuthorityKeyManifest(manifest, manifestPath, hashPath);
    persistTrustedAuthorities(trusted, trustedPath);

    await rotateAuthorityKey(
      {
        authorityId: "ava007-authority-v2",
        publicKey: "pub-v2",
        reason: "emergency-rotation",
        rotatedAt: "2026-07-02T00:00:00.000Z",
      },
      {
        manifestPath,
        manifestHashPath: hashPath,
        trustedAuthoritiesPath: trustedPath,
        rotationLedgerPath: ledgerPath,
      },
    );

    const ledgerLines = (await readFile(ledgerPath, "utf8"))
      .trim()
      .split("\n")
      .filter((line) => line.length > 0);

    expect(ledgerLines).toHaveLength(1);
    const parsed = JSON.parse(ledgerLines[0]) as {
      replacedAuthorityId: string;
      replacementAuthorityId: string;
      reason: string;
    };

    expect(parsed.replacedAuthorityId).toBe("ava007-authority-v1");
    expect(parsed.replacementAuthorityId).toBe("ava007-authority-v2");
    expect(parsed.reason).toBe("emergency-rotation");
  });
});
