import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { signPayload } from "../../trust/verification/signerService.js";
import { Vertex, computeVertexHash, validateVertex } from "../../trust/tashi/vertex.js";

function buildSignedVertex(): { vertex: Vertex; publicKeyPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  const publicKeyPem = publicKey.export({ format: "pem", type: "spki" }).toString();

  const parentHashes: string[] = [];
  const creatorDid = "did:ava:test-node";
  const timestamp = Date.now();
  const payload = {
    type: "event",
    content: "signed vertex",
  };

  const hash = computeVertexHash({
    parentHashes,
    creatorDid,
    timestamp,
    payload,
  });

  const signature = signPayload(
    {
      hash,
      parentHashes,
      creatorDid,
      timestamp,
      payload,
    },
    privateKeyPem,
  );

  return {
    vertex: {
      hash,
      parentHashes,
      creatorDid,
      signature,
      timestamp,
      payload,
    },
    publicKeyPem,
  };
}

describe("tashi vertex proto contract", () => {
  it("declares canonical Vertex fields in proto", () => {
    const proto = readFileSync("tashi/dag/vertex.proto", "utf8");

    expect(proto).toContain("message Vertex");
    expect(proto).toContain("string hash = 1;");
    expect(proto).toContain("repeated string parent_hashes = 2;");
    expect(proto).toContain("string creator_did = 3;");
    expect(proto).toContain("string signature = 4;");
    expect(proto).toContain("int64 timestamp_ms = 5;");
    expect(proto).toContain("string atom_id = 6;");
    expect(proto).toContain("string atom_hash = 7;");
    expect(proto).toContain("google.protobuf.Struct payload = 8;");
  });

  it("validates a signed vertex against DID resolver", () => {
    const { vertex, publicKeyPem } = buildSignedVertex();
    const validation = validateVertex(vertex, {
      knownVertexHashes: new Set<string>(),
      publicKeyResolver: (did) => (did === "did:ava:test-node" ? publicKeyPem : null),
      nowMs: vertex.timestamp,
      maxFutureSkewMs: 1000,
    });

    expect(validation.valid).toBe(true);
  });
});
