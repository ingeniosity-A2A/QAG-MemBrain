import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { TimelineEvent, TimelineSnapshot } from "../timeline/types.js";

export interface ReplayExport {
  version: "1.0";
  exportedAt: string;
  events: TimelineEvent[];
  snapshots: TimelineSnapshot[];
}

export async function saveTimeline(filePath: string, events: TimelineEvent[]): Promise<void> {
  assertTimelineEvents(events);
  await mkdir(dirname(filePath), { recursive: true });

  const payload = {
    version: "1.0",
    savedAt: new Date().toISOString(),
    events,
  };

  await writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
}

export async function loadTimeline(filePath: string): Promise<TimelineEvent[]> {
  const raw = await readFile(filePath, "utf8");
  const parsed = JSON.parse(raw) as {
    events?: unknown;
  };

  if (!Array.isArray(parsed.events)) {
    throw new Error("Invalid timeline file: events array is required");
  }

  assertTimelineEvents(parsed.events);
  return parsed.events;
}

export async function exportReplay(filePath: string, replay: ReplayExport): Promise<void> {
  assertReplayExport(replay);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(replay, null, 2), "utf8");
}

export async function importReplay(filePath: string): Promise<ReplayExport> {
  const raw = await readFile(filePath, "utf8");
  const parsed = JSON.parse(raw) as ReplayExport;
  assertReplayExport(parsed);
  return parsed;
}

function assertReplayExport(value: unknown): asserts value is ReplayExport {
  if (typeof value !== "object" || value === null) {
    throw new Error("Invalid replay export: expected object");
  }

  const replay = value as Partial<ReplayExport>;
  if (replay.version !== "1.0") {
    throw new Error("Invalid replay export: version must be '1.0'");
  }

  if (typeof replay.exportedAt !== "string" || Number.isNaN(Date.parse(replay.exportedAt))) {
    throw new Error("Invalid replay export: exportedAt must be an ISO timestamp");
  }

  if (!Array.isArray(replay.events)) {
    throw new Error("Invalid replay export: events array is required");
  }

  if (!Array.isArray(replay.snapshots)) {
    throw new Error("Invalid replay export: snapshots array is required");
  }

  assertTimelineEvents(replay.events);
  assertTimelineSnapshots(replay.snapshots);
}

function assertTimelineEvents(events: unknown): asserts events is TimelineEvent[] {
  if (!Array.isArray(events)) {
    throw new Error("Invalid timeline events: expected array");
  }

  for (const event of events) {
    if (typeof event !== "object" || event === null) {
      throw new Error("Invalid timeline event: expected object");
    }

    const candidate = event as Partial<TimelineEvent>;
    if (typeof candidate.id !== "string" || candidate.id.length === 0) {
      throw new Error("Invalid timeline event: id is required");
    }

    if (typeof candidate.timestamp !== "string" || Number.isNaN(Date.parse(candidate.timestamp))) {
      throw new Error("Invalid timeline event: timestamp must be an ISO timestamp");
    }

    if (candidate.decisionId !== undefined && typeof candidate.decisionId !== "string") {
      throw new Error("Invalid timeline event: decisionId must be a string when provided");
    }

    if (typeof candidate.patch !== "object" || candidate.patch === null || Array.isArray(candidate.patch)) {
      throw new Error("Invalid timeline event: patch must be an object");
    }
  }
}

function assertTimelineSnapshots(snapshots: unknown): asserts snapshots is TimelineSnapshot[] {
  if (!Array.isArray(snapshots)) {
    throw new Error("Invalid timeline snapshots: expected array");
  }

  for (const snapshot of snapshots) {
    if (typeof snapshot !== "object" || snapshot === null) {
      throw new Error("Invalid timeline snapshot: expected object");
    }

    const candidate = snapshot as Partial<TimelineSnapshot>;
    if (typeof candidate.at !== "string" || Number.isNaN(Date.parse(candidate.at))) {
      throw new Error("Invalid timeline snapshot: at must be an ISO timestamp");
    }

    if (typeof candidate.state !== "object" || candidate.state === null || Array.isArray(candidate.state)) {
      throw new Error("Invalid timeline snapshot: state must be an object");
    }
  }
}
