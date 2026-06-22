export interface AuditEntry {
  timestamp: number;
  decision: string;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  reasoning: string;
}

export interface AuditResponse {
  entries: AuditEntry[];
}

export function handleAuditGet(query: Record<string, string | undefined>): AuditResponse {
  const limit = query.limit ? Number.parseInt(query.limit, 10) : 100;
  const clampedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(limit, 1000)) : 100;

  const entry: AuditEntry = {
    timestamp: Date.now(),
    decision: "routing",
    inputs: {},
    outputs: {},
    reasoning: "easing probability favored direct_ip (0.72)",
  };

  return {
    entries: Array.from({ length: Math.min(clampedLimit, 1) }, () => entry),
  };
}
