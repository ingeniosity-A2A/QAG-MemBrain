import { LedgerEntry } from "../../memory/ledger/jsonlLedger.js";

export interface TashiVertex {
  hash: string;
  parentHashes: string[];
  signature: string;
  atomId: string;
}

export interface TashiConsensus {
  createVertex(entry: LedgerEntry, parentHashes: string[]): Promise<TashiVertex>;
  verifyLineage(vertex: TashiVertex): Promise<boolean>;
  validateConsensus(vertices: TashiVertex[]): Promise<boolean>;
}
