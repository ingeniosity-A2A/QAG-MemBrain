import { describe, expect, it } from "vitest";
import { handleApiRequest } from "../../interfaces/api/server.js";

describe("revike internal api contract", () => {
  it("returns revike synthesis for signed request", async () => {
    const response = await handleApiRequest("POST", "/internal/revike", {
      headers: {
        Signature: "did:ava:test-node:Ed25519:ZmFrZVNpZw==",
      },
      body: {
        request_id: "req_8847",
        operational_context: "Technician swarm stalled at Buckhead due to bracket incompatibility",
        location: "Buckhead",
        required_output: "audio",
      },
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      philosophical_diagnosis: expect.any(String),
      strategic_advice: expect.any(String),
      tactical_directive: expect.any(String),
      audio_asset_url: expect.stringContaining("req_8847.mp3"),
      retrieval: {
        themes: expect.any(Array),
        memory_ids: expect.any(Array),
      },
    });
  });

  it("rejects unsigned revike requests", async () => {
    const response = await handleApiRequest("POST", "/internal/revike", {
      body: {
        request_id: "req_8848",
        operational_context: "Need command framing",
      },
    });

    expect(response.status).toBe(401);
  });
});