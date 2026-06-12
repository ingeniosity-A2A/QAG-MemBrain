import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signPayload } from "../../trust/verification/signerService.js";
import { Vertex, computeVertexHash, validateVertex } from "../../trust/tashi/vertex.js";

function createSignedVertex(input: {
  parentHashes: string[];
  creatorDid: string;
  timestamp: number;
  payload: Record<string, unknown>;
  privateKeyPem: string;
}): Vertex {
  const hash = computeVertexHash({
    parentHashes: input.parentHashes,
    creatorDid: input.creatorDid,
    timestamp: input.timestamp,
    payload: input.payload,
  });

  const signature = signPayload(
    {
      hash,
      parentHashes: input.parentHashes,
      creatorDid: input.creatorDid,
      timestamp: input.timestamp,
      payload: input.payload,
    },
    input.privateKeyPem,
  );

  return {
    hash,
    parentHashes: input.parentHashes,
    creatorDid: input.creatorDid,
    timestamp: input.timestamp,
    payload: input.payload,
    signature,
  };
}

describe("Vertex validation", () => {
  it("accepts valid parent hash, signature, and timestamp", () => {
    const signer = generateKeyPairSync("ed25519");
    const privateKeyPem = signer.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    const publicKeyPem = signer.publicKey.export({ format: "pem", type: "spki" }).toString();

    const root = createSignedVertex({
      parentHashes: [],
      creatorDid: "did:ava:test",
      timestamp: Date.now(),
      payload: { id: "root" },
      privateKeyPem,
    });

    const child = createSignedVertex({
      parentHashes: [root.hash],
      creatorDid: "did:ava:test",
      timestamp: Date.now(),
      payload: { id: "child" },
      privateKeyPem,
    });

    const known = new Set<string>([root.hash]);
    const result = validateVertex(child, {
      knownVertexHashes: known,
      publicKeyResolver: (did) => (did === "did:ava:test" ? publicKeyPem : null),
    });

    expect(result.valid).toBe(true);
  });

  it("rejects orphan vertex, invalid signature, and broken chain", () => {
    const signer = generateKeyPairSync("ed25519");
    const attacker = generateKeyPairSync("ed25519");
    const privateKeyPem = signer.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    const attackerPrivatePem = attacker.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    const publicKeyPem = signer.publicKey.export({ format: "pem", type: "spki" }).toString();

    const orphan = createSignedVertex({
      parentHashes: ["missing-parent"],
      creatorDid: "did:ava:test",
      timestamp: Date.now(),
      payload: { id: "orphan" },
      privateKeyPem,
    });

    const orphanResult = validateVertex(orphan, {
      knownVertexHashes: new Set<string>(),
      publicKeyResolver: () => publicKeyPem,
    });
    expect(orphanResult.valid).toBe(false);
    expect(orphanResult.reason).toBe("orphan vertex");

    const invalidSignature = createSignedVertex({
      parentHashes: [],
      creatorDid: "did:ava:test",
      timestamp: Date.now(),
      payload: { id: "bad-sig" },
      privateKeyPem: attackerPrivatePem,
    });

    const sigResult = validateVertex(invalidSignature, {
      knownVertexHashes: new Set<string>(),
      publicKeyResolver: () => publicKeyPem,
    });
    expect(sigResult.valid).toBe(false);
    expect(sigResult.reason).toBe("invalid signature");

    const broken = createSignedVertex({
      parentHashes: [],
      creatorDid: "did:ava:test",
      timestamp: Date.now(),
      payload: { id: "broken" },
      privateKeyPem,
    });

    const firstNibble = broken.hash[0] === "f" ? "e" : "f";

    const tampered: Vertex = {
      ...broken,
      hash: `${firstNibble}${broken.hash.slice(1)}`,
    };

    const brokenResult = validateVertex(tampered, {
      knownVertexHashes: new Set<string>(),
      publicKeyResolver: () => publicKeyPem,
    });
    expect(brokenResult.valid).toBe(false);
    expect(brokenResult.reason).toBe("broken chain hash");
  });
});
