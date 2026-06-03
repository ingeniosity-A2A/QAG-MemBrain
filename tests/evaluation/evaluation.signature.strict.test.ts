import { createPublicKey, generateKeyPairSync, sign as signBuffer, verify as verifyBuffer } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AUTHORITY_KEY_HASH_PATH,
  AUTHORITY_KEY_MANIFEST_PATH,
  TRUSTED_AUTHORITIES_PATH,
  computeAuthorityManifestHash,
} from "../../authority/signing/keyStore.js";
import { loadAuthoritySignerRegistry } from "../../authority/signing/signerRegistry.js";
import { verifyEvaluationSignature } from "../../evaluation/shared/signing.js";

const originalStrict = process.env.AVA007_STRICT_AUTHORITY_VERIFICATION;
let originalManifestContent = "";
let originalManifestHashContent = "";
let originalTrustedAuthoritiesContent = "";

beforeEach(async () => {
  originalManifestContent = await readFile(AUTHORITY_KEY_MANIFEST_PATH, "utf8");
  originalManifestHashContent = await readFile(AUTHORITY_KEY_HASH_PATH, "utf8");
  originalTrustedAuthoritiesContent = await readFile(TRUSTED_AUTHORITIES_PATH, "utf8");

  process.env.AVA007_STRICT_AUTHORITY_VERIFICATION = "true";
});

afterEach(async () => {
  await writeFile(AUTHORITY_KEY_MANIFEST_PATH, originalManifestContent, "utf8");
  await writeFile(AUTHORITY_KEY_HASH_PATH, originalManifestHashContent, "utf8");
  await writeFile(TRUSTED_AUTHORITIES_PATH, originalTrustedAuthoritiesContent, "utf8");

  if (typeof originalStrict === "undefined") {
    delete process.env.AVA007_STRICT_AUTHORITY_VERIFICATION;
  } else {
    process.env.AVA007_STRICT_AUTHORITY_VERIFICATION = originalStrict;
  }
});

describe("Evaluation signature strict verification", () => {
  it("verifies through authority registry in strict mode", async () => {
    const keyPair = generateKeyPairSync("ed25519");
    const publicKey = keyPair.publicKey.export({ type: "spki", format: "pem" }).toString();
    const privateKey = keyPair.privateKey;

    const manifest = {
      authorityId: "ava007-authority-v1",
      algorithm: "ed25519",
      publicKey,
      createdAt: "2026-06-03T00:00:00.000Z",
      validFrom: "2026-06-03T00:00:00.000Z",
      status: "active",
    };

    const manifestContent = `${JSON.stringify(manifest, null, 2)}\n`;
    const manifestHash = computeAuthorityManifestHash(manifestContent);

    await writeFile(AUTHORITY_KEY_MANIFEST_PATH, manifestContent, "utf8");
    await writeFile(AUTHORITY_KEY_HASH_PATH, `${manifestHash}\n`, "utf8");
    await writeFile(
      TRUSTED_AUTHORITIES_PATH,
      `${JSON.stringify(
        {
          updatedAt: "2026-06-03T00:00:00.000Z",
          authorities: [manifest],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const hash = "b0f4c2d3e7f6a8b9c0d1e2f30415263748596a7b8c9d0e1f2a3b4c5d6e7f8091";
    const signature = signBuffer(null, Buffer.from(hash, "utf8"), privateKey).toString("base64");

    const payload = {
      algorithm: "ed25519" as const,
      authorityId: "ava007-authority-v1",
      signerId: "ava007-authority-v1",
      signedAt: "2026-06-03T00:10:00.000Z",
      hash,
      signature,
      publicKey: "",
    };

    const registry = loadAuthoritySignerRegistry();
    expect(registry.resolvePublicKey(payload.authorityId)).toBe(publicKey);
    expect(registry.isAuthorityValidAt(payload.authorityId, payload.signedAt)).toBe(true);
    expect(
      verifyBuffer(
        null,
        Buffer.from(payload.hash, "utf8"),
        createPublicKey(publicKey),
        Buffer.from(payload.signature, "base64"),
      ),
    ).toBe(true);

    expect(verifyEvaluationSignature(payload)).toBe(true);

    const storedHash = (await readFile(AUTHORITY_KEY_HASH_PATH, "utf8")).trim();
    expect(storedHash).toBe(manifestHash);
  });
});
