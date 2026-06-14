import { AuthorityReplayService, ReplayRequest, ReplayResponse } from "./authorityReplayService.js";

export class AuthorityReplayController {
  constructor(private readonly service: AuthorityReplayService) {}

  async replay(request: ReplayRequest): Promise<ReplayResponse> {
    return this.service.replay(this.normalizeDecisionId(request.decisionId));
  }

  async replaySession(sessionId: string): Promise<ReplayResponse[]> {
    return this.service.replaySession(this.normalizeIdentifier(sessionId, "sessionId"));
  }

  async replayLineage(lineageId: string): Promise<ReplayResponse[]> {
    return this.service.replayLineage(this.normalizeIdentifier(lineageId, "lineageId"));
  }

  async replayRange(start: string, end: string): Promise<ReplayResponse[]> {
    return this.service.replayRange(
      this.normalizeIdentifier(start, "start"),
      this.normalizeIdentifier(end, "end"),
    );
  }

  private normalizeDecisionId(decisionId: string): string {
    return this.normalizeIdentifier(decisionId, "decisionId");
  }

  private normalizeIdentifier(value: string, field: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(`Invalid ${field}`);
    }

    return value.trim();
  }
}