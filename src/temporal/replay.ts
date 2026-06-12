import { MemoryStore, type MemoryEntry } from '../memory/jsonl/index.js';

export interface TimelineEntry {
  seq: number;
  ts: string;
  event: string;
  state: unknown;
  causality: number[];
}

export class TemporalReplay {
  private store: MemoryStore;
  private timeline: TimelineEntry[] = [];

  constructor(store: MemoryStore) { this.store = store; }

  replay(): ReadonlyArray<Readonly<TimelineEntry>> {
    const entries = this.store.readAll();
    this.timeline = entries.map(e => this._project(e));
    return this.timeline;
  }

  replayFrom(checkpointSeq: number): ReadonlyArray<Readonly<TimelineEntry>> {
    const entries = this.store.readRange(checkpointSeq, Infinity);
    return entries.map(e => this._project(e));
  }

  get current(): ReadonlyArray<Readonly<TimelineEntry>> { return this.timeline; }

  findByEvent(eventType: string): ReadonlyArray<Readonly<TimelineEntry>> {
    return this.timeline.filter(t => t.event === eventType);
  }

  private _project(entry: MemoryEntry): TimelineEntry {
    return {
      seq: entry.seq,
      ts: entry.ts,
      event: `${entry.layer}:${entry.type}`,
      state: entry.payload,
      causality: entry.seq > 1 ? [entry.seq - 1] : [],
    };
  }
}
