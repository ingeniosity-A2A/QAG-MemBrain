import { createHash } from "node:crypto";
import { stableStringify } from "../../memory/jsonl/hash.js";
import { verifyPayload } from "../verification/signerService.js";

export interface Vertex {
  hash: string;
  parentHashes: string[];
  creatorDid: string;
  signature: string;
  timestamp: number;
  payload: Record<string, unknown>;
}

export interface VertexValidationOptions {
  knownVertexHashes: Set<string>;
  publicKeyResolver: (did: string) => string | null;
  nowMs?: number;
  maxFutureSkewMs?: number;
}

export function computeVertexHash(input: {
  parentHashes: string[];
  creatorDid: string;
  timestamp: number;
  payload: Record<string, unknown>;
}): string {
  const canonical = stableStringify({
    parentHashes: [...new Set(input.parentHashes)].sort((a, b) => a.localeCompare(b)),
    creatorDid: input.creatorDid,
    timestamp: input.timestamp,
    payload: input.payload,
  });

  return createHash("sha256").update(canonical).digest("hex");
}

export function validateVertex(vertex: Vertex, options: VertexValidationOptions): { valid: boolean; reason?: string } {
  if (!vertex.hash || !vertex.creatorDid || !vertex.signature || !Number.isFinite(vertex.timestamp)) {
    return { valid: false, reason: "vertex fields are malformed" };
  }

  const expectedHash = computeVertexHash({
    parentHashes: vertex.parentHashes,
    creatorDid: vertex.creatorDid,
    timestamp: vertex.timestamp,
    payload: vertex.payload,
  });

  if (expectedHash !== vertex.hash) {
    return { valid: false, reason: "broken chain hash" };
  }

  const now = options.nowMs ?? Date.now();
  const skew = options.maxFutureSkewMs ?? 60_000;
  if (vertex.timestamp > now + skew || vertex.timestamp <= 0) {
    return { valid: false, reason: "invalid timestamp" };
  }

  const orphanParent = vertex.parentHashes.find((hash) => !options.knownVertexHashes.has(hash));
  if (orphanParent) {
    return { valid: false, reason: "orphan vertex" };
  }

  const publicKey = options.publicKeyResolver(vertex.creatorDid);
  if (!publicKey) {
    return { valid: false, reason: "invalid signer" };
  }

  const signedPayload = {
    hash: vertex.hash,
    parentHashes: vertex.parentHashes,
    creatorDid: vertex.creatorDid,
    timestamp: vertex.timestamp,
    payload: vertex.payload,
  };

  if (!verifyPayload(signedPayload, vertex.signature, publicKey)) {
    return { valid: false, reason: "invalid signature" };
  }

  return { valid: true };
}
