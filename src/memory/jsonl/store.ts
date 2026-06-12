/**
 * L1 – Memory Store
 * Append-only JSONL journal. No mutation, no deletion.
 * Every entry is signed and sequentially numbered.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export interface MemoryEntry {
  seq: number;
  ts: string;
  layer: 1 | 2 | 3 | 4 | 5 | 6;
  type: string;
  payload: unknown;
  hash: string;
  prevHash: string;
}

export class MemoryStore {
  private filePath: string;
  private nextSeq: number = 1;
  private lastHash: string = '0'.repeat(64);

  constructor(dir: string, name: string = 'memory.jsonl') {
    fs.mkdirSync(dir, { recursive: true });
    this.filePath = path.join(dir, name);
    this._reindex();
  }

  append(layer: MemoryEntry['layer'], type: string, payload: unknown): MemoryEntry {
    const entry: MemoryEntry = {
      seq: this.nextSeq,
      ts: new Date().toISOString(),
      layer,
      type,
      payload,
      hash: '',
      prevHash: this.lastHash,
    };
    entry.hash = this._hash(entry);
    const line = JSON.stringify(entry) + '\n';
    fs.appendFileSync(this.filePath, line, 'utf-8');
    this.nextSeq++;
    this.lastHash = entry.hash;
    return entry;
  }

  readAll(): ReadonlyArray<Readonly<MemoryEntry>> {
    if (!fs.existsSync(this.filePath)) return [];
    const raw = fs.readFileSync(this.filePath, 'utf-8');
    return raw.trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  }

  readRange(from: number, to: number): ReadonlyArray<Readonly<MemoryEntry>> {
    return this.readAll().filter(e => e.seq >= from && e.seq <= to);
  }

  verify(): boolean {
    const entries = this.readAll();
    let prev = '0'.repeat(64);
    for (const e of entries) {
      if (e.prevHash !== prev) return false;
      const recomputed = this._hash({ ...e, hash: '' });
      if (e.hash !== recomputed) return false;
      prev = e.hash;
    }
    return true;
  }

  get seq(): number { return this.nextSeq - 1; }

  private _hash(entry: Omit<MemoryEntry, 'hash'>): string {
    const data = `${entry.seq}${entry.ts}${entry.layer}${entry.type}${JSON.stringify(entry.payload)}${entry.prevHash}`;
    return crypto.createHash('sha256').update(data, 'utf-8').digest('hex');
  }

  private _reindex(): void {
    const entries = this.readAll();
    if (entries.length > 0) {
      const last = entries[entries.length - 1];
      this.nextSeq = last.seq + 1;
      this.lastHash = last.hash;
    }
  }
}
