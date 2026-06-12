import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { InMemoryDIDRegistry } from "../../trust/did/didRegistry.js";

function publicKeyPem(): string {
  const { publicKey } = generateKeyPairSync("ed25519");
  return publicKey.export({ format: "pem", type: "spki" }).toString();
}

describe("DID registry", () => {
  it("creates and resolves DID documents", () => {
    const registry = new InMemoryDIDRegistry();
    const doc = registry.createDID({ id: "did:ava:test-1", algorithm: "ed25519", publicKeyPem: publicKeyPem() });

    const resolved = registry.resolveDID(doc.id);
    expect(resolved?.id).toBe("did:ava:test-1");
    expect(resolved?.publicKeys).toHaveLength(1);
  });

  it("rotates keys and revokes old key", () => {
    const registry = new InMemoryDIDRegistry();
    const doc = registry.createDID({ id: "did:ava:test-2", algorithm: "ed25519", publicKeyPem: publicKeyPem() });

    const rotated = registry.rotateKey(doc.id, { algorithm: "ed25519", publicKeyPem: publicKeyPem() });
    expect(rotated.publicKeys).toHaveLength(2);

    const revoked = registry.revokeKey(doc.id, rotated.publicKeys[0].keyId);
    const active = registry.activeKeys(doc.id);

    expect(revoked.publicKeys.find((key) => key.keyId === rotated.publicKeys[0].keyId)?.revokedAt).toBeDefined();
    expect(active).toHaveLength(1);
  });
});
