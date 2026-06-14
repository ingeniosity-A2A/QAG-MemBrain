import { AuthorityReplayAudit } from "./authorityReplayAudit.js";
import { AuthorityReplayEngine } from "./authorityReplayEngine.js";
import { AuthorityReplayResult } from "./authorityReplayResult.js";

export class AuthorityReplayRunner {
  constructor(
    private readonly engine: AuthorityReplayEngine,
    private readonly audit?: AuthorityReplayAudit,
  ) {}

  async run(decisionId: string): Promise<AuthorityReplayResult> {
    const result = await this.engine.execute(decisionId);
    if (this.audit) {
      this.audit.record(result);
    }

    return result;
  }
}