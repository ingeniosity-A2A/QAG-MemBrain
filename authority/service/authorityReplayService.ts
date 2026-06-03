import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { AuthorityReplayEngine, AuthorityReplayExecutionDependencies } from "../execution/authorityReplayEngine.js";
import { AuthorityReplayQueue } from "./authorityReplayQueue.js";
import { AuthorityReplayMetrics, ReplayMetrics } from "./authorityReplayMetrics.js";
import { ReplayRecord } from "./replayRecord.js";
import { JsonlReplayRepository, ReplayRepository } from "../persistence/replayRepository.js";

export interface ReplayRequest {
  decisionId: string;
}

export interface ReplayResponse {
  status: "VERIFIED" | "FAILED";
  reportId: string;
  failures: string[];
}

export interface AuthorityReplayServiceDependencies extends AuthorityReplayExecutionDependencies {
  listDecisionIdsBySession(sessionId: string): Promise<string[]>;
  listDecisionIdsByLineage(lineageId: string): Promise<string[]>;
  listDecisionIdsByRange(start: string, end: string): Promise<string[]>;
  replayRepository?: ReplayRepository;
}

export class AuthorityReplayService {
  private readonly engine: AuthorityReplayEngine;
  private readonly queue = new AuthorityReplayQueue();
  private readonly metrics = new AuthorityReplayMetrics();
  private readonly replayRepository: ReplayRepository;

  constructor(private readonly deps: AuthorityReplayServiceDependencies) {
    this.engine = new AuthorityReplayEngine(deps);
    this.replayRepository = deps.replayRepository ?? new JsonlReplayRepository(DEFAULT_REPLAY_LEDGER_PATH);
  }

  async replay(decisionId: string): Promise<ReplayResponse> {
    return this.queue.enqueueReplay(decisionId, () => this.executeReplay(decisionId));
  }

  async replaySession(sessionId: string): Promise<ReplayResponse[]> {
    const decisionIds = await this.deps.listDecisionIdsBySession(sessionId);
    return this.queue.enqueueSessionReplay(sessionId, () => this.executeBatch(decisionIds));
  }

  async replayLineage(lineageId: string): Promise<ReplayResponse[]> {
    const decisionIds = await this.deps.listDecisionIdsByLineage(lineageId);
    return this.queue.enqueueLineageReplay(lineageId, () => this.executeBatch(decisionIds));
  }

  async replayRange(start: string, end: string): Promise<ReplayResponse[]> {
    const decisionIds = await this.deps.listDecisionIdsByRange(start, end);
    return this.queue.enqueueRangeReplay(start, end, () => this.executeBatch(decisionIds));
  }

  async listReplayRecords(): Promise<ReplayRecord[]> {
    return this.replayRepository.list();
  }

  getMetrics(): ReplayMetrics {
    return this.metrics.snapshot();
  }

  private async executeBatch(decisionIds: string[]): Promise<ReplayResponse[]> {
    const responses: ReplayResponse[] = [];
    for (const decisionId of decisionIds) {
      responses.push(await this.executeReplay(decisionId));
    }

    return responses;
  }

  private async executeReplay(decisionId: string): Promise<ReplayResponse> {
    const startedAt = new Date().toISOString();
    const started = Date.now();
    const result = await this.engine.execute(decisionId);
    const completedAt = new Date().toISOString();
    const replayId = randomUUID();

    const record: ReplayRecord = {
      replayId,
      decisionId: result.decisionId,
      lineageId: result.lineageId,
      status: result.status,
      failures: [...result.failures],
      startedAt,
      completedAt,
    };

    await this.replayRepository.append(record);
    this.metrics.record(result, Date.now() - started);

    return {
      status: result.status,
      reportId: replayId,
      failures: [...result.failures],
    };
  }
}

const DEFAULT_REPLAY_LEDGER_PATH = join(process.cwd(), "authority", "replay", "replay.jsonl");