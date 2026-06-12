import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ReplayEngine } from "../../temporal/replay/replayEngine.js";
import {
  exportReplay,
  importReplay,
  loadTimeline,
  saveTimeline,
} from "../../temporal/serialization/timelineSerialization.js";

const cleanupTargets: string[] = [];

afterEach(async () => {
  while (cleanupTargets.length > 0) {
    const path = cleanupTargets.pop();
    if (path) {
      await rm(path, { recursive: true, force: true });
    }
  }
});

describe("Temporal serialization", () => {
  it("persists and reloads timeline events", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qag-membrain-temporal-"));
    cleanupTargets.push(dir);

    const filePath = join(dir, "timeline.json");
    const events = [
      {
        id: "evt-1",
        timestamp: "2026-06-03T01:00:00.000Z",
        decisionId: "decision-1",
        patch: { stage: "memory_stored" },
      },
      {
        id: "evt-2",
        timestamp: "2026-06-03T01:00:01.000Z",
        decisionId: "decision-1",
        patch: { stage: "decision_explained" },
      },
    ];

    await saveTimeline(filePath, events);
    const loaded = await loadTimeline(filePath);

    expect(loaded).toEqual(events);
  });

  it("exports and imports replay data", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qag-membrain-temporal-"));
    cleanupTargets.push(dir);

    const filePath = join(dir, "replay.json");
    const events = [
      {
        id: "evt-3",
        timestamp: "2026-06-03T01:00:00.000Z",
        decisionId: "decision-2",
        patch: { stage: "memory_stored" },
      },
      {
        id: "evt-4",
        timestamp: "2026-06-03T01:00:02.000Z",
        decisionId: "decision-2",
        patch: { stage: "decision_executed" },
      },
    ];

    const replay = new ReplayEngine(events);
    const snapshot = replay.seek("2026-06-03T01:00:02.000Z");

    const exportPayload = {
      version: "1.0" as const,
      exportedAt: "2026-06-03T01:10:00.000Z",
      events,
      snapshots: [snapshot],
    };

    await exportReplay(filePath, exportPayload);
    const imported = await importReplay(filePath);

    expect(imported).toEqual(exportPayload);
  });

  it("rejects malformed timeline files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qag-membrain-temporal-"));
    cleanupTargets.push(dir);

    const filePath = join(dir, "bad-timeline.json");
    await writeFile(
      filePath,
      JSON.stringify({
      version: "1.0",
      exportedAt: "2026-06-03T01:10:00.000Z",
      events: [
        {
          id: "evt-bad",
          timestamp: "not-an-iso-date",
          patch: { stage: "bad" },
        },
      ],
      snapshots: [],
      }),
      "utf8",
    );

    await expect(importReplay(filePath)).rejects.toThrow(/timestamp/i);
  });
});
