import { describe, expect, it } from "vitest";
import { handleApiRequest } from "../../interfaces/api/server.js";

describe("memory-recall api contract", () => {
  it("supports POST /memory and GET /recall with DID signature header", async () => {
    const signatureHeader = {
      Signature: "did:ava:test-node:Ed25519:ZmFrZVNpZw==",
    };

    const memoryResponse = await handleApiRequest("POST", "/memory", {
      headers: signatureHeader,
      body: {
        type: "event",
        source: "nfc_handshake",
        content: "Tap from asset tag 0x7F3A",
      },
    });

    expect(memoryResponse.status).toBe(200);
    expect(memoryResponse.body).toMatchObject({
      id: expect.any(String),
      timestamp: expect.any(Number),
      vertex_hash: expect.any(String),
    });

    const recallResponse = await handleApiRequest("GET", "/recall", {
      headers: signatureHeader,
      query: {
        t: `${Date.now()}`,
        memory_id: (memoryResponse.body as { id: string }).id,
      },
    });

    expect(recallResponse.status).toBe(200);
    expect(recallResponse.body).toEqual({
      state: {
        attention_focus: 0.87,
        current_room: "assembly_knowledge",
        active_protocol: "A2A",
      },
      fidelity: 0.99,
      reconstruction_time_ms: 12,
    });
  });

  it("rejects requests without DID signature", async () => {
    const response = await handleApiRequest("GET", "/recall", {
      query: { t: `${Date.now()}` },
    });

    expect(response.status).toBe(401);
  });
});
