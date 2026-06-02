import { TimelineEvent, TimelineSnapshot } from "../timeline/types.js";

export class ReplayEngine {
  constructor(private readonly events: TimelineEvent[]) {}

  seek(timestamp: string): TimelineSnapshot {
    const state = this.reconstructState(timestamp);
    return {
      at: timestamp,
      state,
    };
  }

  reconstructState(timestamp: string): Record<string, unknown> {
    const cutoff = Date.parse(timestamp);

    const ordered = [...this.events]
      .filter((event) => Date.parse(event.timestamp) <= cutoff)
      .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

    return ordered.reduce<Record<string, unknown>>((acc, event) => {
      return {
        ...acc,
        ...event.patch,
      };
    }, {});
  }

  replayDecision(decisionId: string): TimelineEvent[] {
    return this.events
      .filter((event) => event.decisionId === decisionId)
      .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  }

  branchReplay(branchEvents: TimelineEvent[], timestamp: string): TimelineSnapshot {
    const engine = new ReplayEngine([...this.events, ...branchEvents]);
    return engine.seek(timestamp);
  }

  auditReplay(timestamp: string): { snapshot: TimelineSnapshot; eventCount: number } {
    const snapshot = this.seek(timestamp);
    const eventCount = this.events.filter((event) => Date.parse(event.timestamp) <= Date.parse(timestamp)).length;
    return { snapshot, eventCount };
  }
}
