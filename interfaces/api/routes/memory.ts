import { createHash, randomUUID } from "node:crypto";

export interface MemoryWriteRequest {
  type: string;
  source: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface MemoryWriteResponse {
  id: string;
  timestamp: number;
  vertex_hash: string;
}

export async function handleMemoryPost(body: unknown): Promise<MemoryWriteResponse> {
  const candidate = body as Partial<MemoryWriteRequest> | undefined;
  if (!candidate || typeof candidate.type !== "string" || typeof candidate.source !== "string" || typeof candidate.content !== "string") {
    throw new Error("Invalid memory payload");
  }

  const timestamp = Date.now();
  const vertex_hash = createHash("sha256")
    .update(`${candidate.type}:${candidate.source}:${candidate.content}:${timestamp}`)
    .digest("hex");

  return {
    id: randomUUID(),
    timestamp,
    vertex_hash,
  };
}
