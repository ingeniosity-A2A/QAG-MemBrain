export interface TimelineRoute {
  timelineId: string;
  label: string;
  confidence: number;
}

export class LiteNotebookLM {
  route(query: string): TimelineRoute {
    return {
      timelineId: `timeline_${Buffer.from(query).toString("hex").slice(0, 12)}`,
      label: query.toLowerCase().trim(),
      confidence: query.length > 0 ? 0.8 : 0,
    };
  }
}
