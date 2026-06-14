export interface TimelineTweenUpdate {
  event: "tween_update";
  time: number;
  state: Record<string, unknown>;
}

export interface TimelineCollapse {
  event: "collapse";
  superposition_id: string;
  selected: string;
}

export type TimelineMessage = TimelineTweenUpdate | TimelineCollapse;

export function timelinePath(): string {
  return "/timeline";
}

export function createTimelineMessages(memoryId: string): TimelineMessage[] {
  const now = Date.now();
  return [
    {
      event: "tween_update",
      time: now,
      state: {
        memory_id: memoryId,
      },
    },
    {
      event: "collapse",
      superposition_id: `sp_${memoryId}`,
      selected: "option_b",
    },
  ];
}
