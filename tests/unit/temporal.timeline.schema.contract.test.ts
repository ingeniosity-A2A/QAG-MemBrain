import Ajv from "ajv";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import { ReplayEngine } from "../../temporal/replay/replayEngine.js";
import timelineSchema from "../../temporal/serialization/timeline_schema.json";
import { TimelineEvent } from "../../temporal/timeline/types.js";

describe("temporal timeline schema contract", () => {
  it("accepts timeline and replay-export payloads from timeline_schema.json", () => {
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(timelineSchema);

    const timelineDocument = {
      version: "1.0",
      savedAt: "2026-06-04T00:00:00.000Z",
      events: [
        {
          id: "evt-1",
          timestamp: "2026-06-04T00:00:00.000Z",
          patch: {
            active_protocol: "A2A",
          },
        },
      ],
    };

    const replayExport = {
      version: "1.0",
      exportedAt: "2026-06-04T00:00:02.000Z",
      events: timelineDocument.events,
      snapshots: [
        {
          at: "2026-06-04T00:00:02.000Z",
          state: {
            active_protocol: "A2A",
          },
        },
      ],
    };

    expect(validate(timelineDocument)).toBe(true);
    expect(validate(replayExport)).toBe(true);
  });

  it("replays deterministically for identical event inputs", () => {
    const events: TimelineEvent[] = [
      {
        id: "evt-1",
        timestamp: "2026-06-04T00:00:00.000Z",
        decisionId: "decision-a",
        patch: { attention_focus: 0.5 },
      },
      {
        id: "evt-2",
        timestamp: "2026-06-04T00:00:01.000Z",
        decisionId: "decision-a",
        patch: { attention_focus: 0.87, current_room: "assembly_knowledge" },
      },
    ];

    const at = "2026-06-04T00:00:01.000Z";
    const first = new ReplayEngine(events).seek(at);
    const second = new ReplayEngine(events).seek(at);

    expect(first).toEqual(second);
    expect(first.state).toEqual({
      attention_focus: 0.87,
      current_room: "assembly_knowledge",
    });
  });
});
