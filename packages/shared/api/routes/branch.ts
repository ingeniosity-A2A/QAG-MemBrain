import { createHash } from "node:crypto";

export interface BranchMutation {
  property: string;
  from: string;
  to: string;
  duration: number;
  ease: string;
}

export interface BranchRequest {
  memory_id: string;
  branch_point: number;
  mutations: BranchMutation[];
}

export interface BranchResponse {
  branch_id: string;
  timeline_hash: string;
}

export function handleBranchPost(body: unknown): BranchResponse {
  const candidate = body as Partial<BranchRequest> | undefined;
  if (!candidate || typeof candidate.memory_id !== "string" || !Array.isArray(candidate.mutations) || typeof candidate.branch_point !== "number") {
    throw new Error("Invalid branch payload");
  }

  const timeline_hash = createHash("sha256")
    .update(JSON.stringify(candidate))
    .digest("hex");

  return {
    branch_id: `branch_${candidate.memory_id}`,
    timeline_hash,
  };
}
