import { handleAuditGet } from "./routes/audit.js";
import { handleBranchPost } from "./routes/branch.js";
import { handleMemoryPost } from "./routes/memory.js";
import { handleRecallGet } from "./routes/recall.js";

export interface ApiRequest {
  headers?: Record<string, string | undefined>;
  query?: Record<string, string | undefined>;
  body?: unknown;
}

export interface ApiResponse {
  status: number;
  body: unknown;
}

function hasDidSignatureHeader(request: ApiRequest): boolean {
  const signature = request.headers?.Signature ?? request.headers?.signature;
  return typeof signature === "string" && signature.startsWith("did:");
}

export async function handleApiRequest(method: string, path: string, request: ApiRequest): Promise<ApiResponse> {
  if (!hasDidSignatureHeader(request)) {
    return {
      status: 401,
      body: {
        error: "Missing or invalid signature",
      },
    };
  }

  if (method === "POST" && path === "/memory") {
    return {
      status: 200,
      body: await handleMemoryPost(request.body),
    };
  }

  if (method === "GET" && path === "/recall") {
    return {
      status: 200,
      body: handleRecallGet(request.query ?? {}),
    };
  }

  if (method === "POST" && path === "/branch") {
    return {
      status: 200,
      body: handleBranchPost(request.body),
    };
  }

  if (method === "GET" && path === "/audit") {
    return {
      status: 200,
      body: handleAuditGet(request.query ?? {}),
    };
  }

  return {
    status: 404,
    body: {
      error: "Not found",
    },
  };
}
