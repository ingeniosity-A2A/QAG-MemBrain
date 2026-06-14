import { AuthorityReplayResult } from "./authorityReplayResult.js";

export interface AuthorityReplayAuditEntry extends AuthorityReplayResult {
  timestamp: string;
}

export class AuthorityReplayAudit {
  private readonly entries: AuthorityReplayAuditEntry[] = [];

  record(result: AuthorityReplayResult): AuthorityReplayAuditEntry {
    const entry: AuthorityReplayAuditEntry = {
      ...result,
      timestamp: new Date().toISOString(),
    };

    this.entries.push(entry);
    return entry;
  }

  list(): AuthorityReplayAuditEntry[] {
    return [...this.entries];
  }
}