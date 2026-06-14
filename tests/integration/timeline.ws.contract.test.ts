import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createTimelineMessages, timelinePath } from "../../interfaces/api/ws/timeline.js";

describe("timeline ws contract", () => {
  it("declares /timeline websocket contract in openapi", () => {
    const openapi = readFileSync("interfaces/api/openapi.v1.yaml", "utf8");

    expect(openapi).toContain("/timeline:");
    expect(openapi).toContain("x-websocket:");
    expect(openapi).toContain("path: /timeline");
  });

  it("emits contract-shaped timeline messages", () => {
    expect(timelinePath()).toBe("/timeline");

    const messages = createTimelineMessages("mem-123");
    expect(messages).toHaveLength(2);

    expect(messages[0]).toMatchObject({
      event: "tween_update",
      time: expect.any(Number),
      state: {
        memory_id: "mem-123",
      },
    });

    expect(messages[1]).toEqual({
      event: "collapse",
      superposition_id: "sp_mem-123",
      selected: "option_b",
    });
  });
});