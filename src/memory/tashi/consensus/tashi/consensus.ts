import { LedgerEntry } from "../../ledger/jsonlLedger.js";
import { createHash } from "node:crypto";
import { DagPathProvenance } from "../../../jsonl/provenance.js";

export interface TashiVertex {
  hash: string;
  parentHashes: string[];
  signature: string;
  atomId: string;
  atomHash: string;
}

export interface TashiConsensus {
  createVertex(entry: LedgerEntry, parentHashes: string[]): Promise<TashiVertex>;
  verifyLineage(vertex: TashiVertex): Promise<boolean>;
  validateConsensus(vertices: TashiVertex[]): Promise<boolean>;
}

export class HashChainTashiConsensus implements TashiConsensus {
  private readonly vertices = new Map<string, TashiVertex>();

  constructor(private readonly signerId: string = "tashi:local") {}

  async createVertex(entry: LedgerEntry, parentHashes: string[]): Promise<TashiVertex> {
    if (entry.proof.id !== entry.atom.id) {
      throw new Error("Ledger proof id does not match atom id");
    }

    const uniqueParents = [...new Set(parentHashes)];
    const hash = this.computeVertexHash(entry, uniqueParents);
    const vertex: TashiVertex = {
      hash,
      parentHashes: uniqueParents,
      signature: this.computeSignature(hash),
      atomId: entry.atom.id,
      atomHash: entry.atomHash,
    };

    this.vertices.set(vertex.hash, vertex);
    return vertex;
  }

  async verifyLineage(vertex: TashiVertex): Promise<boolean> {
    if (!vertex.hash || !vertex.signature || !vertex.atomId || !vertex.atomHash) {
      return false;
    }

    const stored = this.vertices.get(vertex.hash);
    if (!stored) {
      return false;
    }

    const hasKnownParents = vertex.parentHashes.every((hash) => this.vertices.has(hash));
    if (!hasKnownParents) {
      return false;
    }

    const expectedSignature = this.computeSignature(vertex.hash);
    return expectedSignature === vertex.signature;
  }

  async validateConsensus(vertices: TashiVertex[]): Promise<boolean> {
    const seen = new Set<string>();

    for (const vertex of vertices) {
      if (seen.has(vertex.hash)) {
        return false;
      }

      seen.add(vertex.hash);
      const valid = await this.verifyLineage(vertex);
      if (!valid) {
        return false;
      }
    }

    return true;
  }

  private computeVertexHash(entry: LedgerEntry, parentHashes: string[]): string {
    const payload = stableStringify({
      atomId: entry.atom.id,
      atomHash: entry.atomHash,
      payloadHash: entry.hash,
      timestamp: entry.atom.timestamp,
      parentHashes: [...parentHashes].sort((a, b) => a.localeCompare(b)),
    });

    return sha256(payload);
  }

  private computeSignature(vertexHash: string): string {
    return sha256(`${vertexHash}:${this.signerId}`);
  }
}

export function createDagPathProvenance(vertices: TashiVertex[], decisionId?: string): DagPathProvenance {
  if (vertices.length === 0) {
    throw new Error("Cannot create DAG path provenance from an empty vertex path");
  }

  const root = vertices[0];
  const terminal = vertices[vertices.length - 1];
  return {
    rootAtomId: root.atomId,
    rootVertexHash: root.hash,
    terminalVertexHash: terminal.hash,
    vertexHashes: vertices.map((vertex) => vertex.hash),
    atomIds: vertices.map((vertex) => vertex.atomId),
    decisionId,
  };
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  return `{${entries
    .map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`)
    .join(",")}}`;
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
