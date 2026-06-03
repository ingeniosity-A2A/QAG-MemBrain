import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MemoryRecord } from "../../memory/jsonl/memoryRecord.js";
import { signPayload, signRecord, verifyPayload, verifyRecord } from "../../trust/verification/signerService.js";

describe("Signer service", () => {
  it("signs and verifies payloads", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    const publicKeyPem = publicKey.export({ format: "pem", type: "spki" }).toString();

    const payload = { a: 1, b: "x" };
    const signature = signPayload(payload, privateKeyPem);

    expect(verifyPayload(payload, signature, publicKeyPem)).toBe(true);
    expect(verifyPayload({ ...payload, b: "y" }, signature, publicKeyPem)).toBe(false);
  });

  it("rejects invalid signer and tampered record", () => {
    const signer = generateKeyPairSync("ed25519");
    const attacker = generateKeyPairSync("ed25519");
    const signerPrivatePem = signer.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    const signerPublicPem = signer.publicKey.export({ format: "pem", type: "spki" }).toString();
    const attackerPublicPem = attacker.publicKey.export({ format: "pem", type: "spki" }).toString();

    const unsigned: MemoryRecord = {
      id: "m1",
      type: "event",
      source: "sensor",
      timestamp: "2026-06-03T00:00:00.000Z",
      content: "payload",
      metadata: {},
    };

    const signed = signRecord(unsigned, signerPrivatePem);
    expect(verifyRecord(signed, signerPublicPem)).toBe(true);
    expect(verifyRecord(signed, attackerPublicPem)).toBe(false);

    const tampered: MemoryRecord = {
      ...signed,
      content: "tampered",
    };

    expect(verifyRecord(tampered, signerPublicPem)).toBe(false);
  });
});
