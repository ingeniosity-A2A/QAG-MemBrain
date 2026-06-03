import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { AuthorityReplayEngine, AuthorityReplayExecutionDependencies } from "../execution/authorityReplayEngine.js";
import { AuthorityReplayQueue } from "./authorityReplayQueue.js";
import { AuthorityReplayMetrics, ReplayMetrics } from "./authorityReplayMetrics.js";
import { ReplayRecord, ReplayRecordInput } from "./replayRecord.js";
import { JsonlReplayRepository, ReplayRepository } from "../persistence/replayRepository.js";
import { CANONICAL_AUTHORITY_ORDER } from "../replay/replayContract.js";
import { CognitiveGraphRepository } from "../../graph/neo4j/repositories/cognitiveGraphRepository.js";
import { computeReplayHash } from "../persistence/replayHash.js";
import { GovernanceSnapshot } from "../../governance/loader/governanceSnapshot.js";
import { loadGovernanceSnapshot } from "../../governance/loader/governanceLoader.js";
import { BuildSnapshot } from "../build/buildSnapshot.js";
import { loadBuildSnapshot } from "../build/buildLoader.js";
import { DeploymentSnapshot } from "../deployment/deploymentSnapshot.js";
import { loadDeploymentSnapshot } from "../deployment/deploymentLoader.js";
import { RuntimeSnapshot } from "../runtime/runtimeSnapshot.js";
import { loadRuntimeSnapshot } from "../runtime/runtimeLoader.js";
import { sealReplayRecord } from "../persistence/replayProof.js";

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
  graphRepository?: CognitiveGraphRepository;
  loadGovernanceSnapshot?: () => Promise<GovernanceSnapshot>;
  loadBuildSnapshot?: () => BuildSnapshot;
  loadDeploymentSnapshot?: (buildHash: string) => DeploymentSnapshot;
  loadRuntimeSnapshot?: (input: {
    runtimeVersion: string;
    deploymentHash: string;
    buildHash: string;
  }) => RuntimeSnapshot;
}

export class AuthorityReplayService {
  private readonly engine: AuthorityReplayEngine;
  private readonly queue = new AuthorityReplayQueue();
  private readonly metrics = new AuthorityReplayMetrics();
  private readonly replayRepository: ReplayRepository;
  private readonly governanceSnapshotLoader: () => Promise<GovernanceSnapshot>;
  private readonly buildSnapshotLoader: () => BuildSnapshot;
  private readonly deploymentSnapshotLoader: (buildHash: string) => DeploymentSnapshot;
  private readonly runtimeSnapshotLoader: (input: {
    runtimeVersion: string;
    deploymentHash: string;
    buildHash: string;
  }) => RuntimeSnapshot;

  constructor(private readonly deps: AuthorityReplayServiceDependencies) {
    this.engine = new AuthorityReplayEngine(deps);
    this.replayRepository = deps.replayRepository ?? new JsonlReplayRepository(DEFAULT_REPLAY_LEDGER_PATH);
    this.governanceSnapshotLoader = deps.loadGovernanceSnapshot ?? loadGovernanceSnapshot;
    this.buildSnapshotLoader = deps.loadBuildSnapshot ?? loadBuildSnapshot;
    this.deploymentSnapshotLoader = deps.loadDeploymentSnapshot ?? ((buildHash: string) => loadDeploymentSnapshot(buildHash));
    this.runtimeSnapshotLoader = deps.loadRuntimeSnapshot ?? loadRuntimeSnapshot;
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
    const governanceSnapshot = await this.governanceSnapshotLoader();
    const buildSnapshot = this.buildSnapshotLoader();
    const deploymentSnapshot = this.deploymentSnapshotLoader(buildSnapshot.buildHash);
    const runtimeSnapshot = this.runtimeSnapshotLoader({
      runtimeVersion: buildSnapshot.runtimeVersion,
      deploymentHash: deploymentSnapshot.deploymentHash,
      buildHash: buildSnapshot.buildHash,
    });

    const record: ReplayRecordInput = {
      replayId,
      decisionId: result.decisionId,
      lineageId: result.lineageId,
      governanceVersion: governanceSnapshot.governanceVersion,
      governanceHash: governanceSnapshot.governanceHash,
      manifestHash: governanceSnapshot.manifestHash,
      attestationHash: governanceSnapshot.attestationHash,
      runtimeVersion: runtimeSnapshot.runtimeVersion,
      runtimeHash: runtimeSnapshot.runtimeHash,
      runtimeStartedAt: runtimeSnapshot.startedAt,
      runtimeHost: runtimeSnapshot.hostname,
      runtimeProcessId: runtimeSnapshot.processId,
      runtimeNodeVersion: runtimeSnapshot.nodeVersion,
      runtimePlatform: runtimeSnapshot.platform,
      gitCommit: buildSnapshot.gitCommit,
      buildHash: buildSnapshot.buildHash,
      buildTimestamp: buildSnapshot.buildTimestamp,
      worktreeDirty: buildSnapshot.worktreeDirty,
      deploymentVersion: deploymentSnapshot.deploymentVersion,
      deploymentHash: deploymentSnapshot.deploymentHash,
      releaseId: deploymentSnapshot.releaseId,
      environment: deploymentSnapshot.environment,
      status: result.status,
      failureReasons: [...result.failures],
      authorityOrder: [...governanceSnapshot.authorityOrder],
      timestamp: completedAt,
      startedAt,
      completedAt,
    };

    const sealedRecord = sealReplayRecord(record);

    await this.replayRepository.append(sealedRecord);
    await this.materializeReplayGraph(sealedRecord);
    this.metrics.record(result, Date.now() - started);

    return {
      status: result.status,
      reportId: replayId,
      failures: [...result.failures],
    };
  }

  private async materializeReplayGraph(record: ReplayRecord): Promise<void> {
    const graphRepository = this.deps.graphRepository;
    if (!graphRepository) {
      return;
    }

    await graphRepository.upsertNode({
      id: record.decisionId,
      type: "Decision",
      properties: {
        decisionId: record.decisionId,
      },
    });

    await graphRepository.upsertNode({
      id: record.replayId,
      type: "Replay",
      properties: {
        replayId: record.replayId,
        decisionId: record.decisionId,
        lineageId: record.lineageId,
        governanceVersion: record.governanceVersion,
        governanceHash: record.governanceHash,
        manifestHash: record.manifestHash,
        attestationHash: record.attestationHash,
        runtimeVersion: record.runtimeVersion,
        runtimeHash: record.runtimeHash,
        runtimeStartedAt: record.runtimeStartedAt,
        runtimeHost: record.runtimeHost,
        runtimeProcessId: record.runtimeProcessId,
        runtimeNodeVersion: record.runtimeNodeVersion,
        runtimePlatform: record.runtimePlatform,
        gitCommit: record.gitCommit,
        buildHash: record.buildHash,
        buildTimestamp: record.buildTimestamp,
        worktreeDirty: record.worktreeDirty,
        deploymentVersion: record.deploymentVersion,
        deploymentHash: record.deploymentHash,
        releaseId: record.releaseId,
        environment: record.environment,
        status: record.status,
        failureReasons: [...record.failureReasons],
        authorityOrder: [...record.authorityOrder],
        replayHash: record.replayHash,
        signatureId: record.signature.signatureId,
        signature: record.signature.signature,
        signatureAlgorithm: record.signature.algorithm,
        signatureSignedAt: record.signature.signedAt,
        signatureAuthorityId: record.signature.authorityId,
        signatureSignerId: record.signature.signerId,
        signatureArtifactHash: record.signature.artifactHash,
        signaturePublicKey: record.signature.publicKey,
        timestamp: record.timestamp,
        startedAt: record.startedAt,
        completedAt: record.completedAt,
      },
    });

    await graphRepository.createRelationship({
      fromId: record.decisionId,
      toId: record.replayId,
      type: "REPLAYED",
      properties: {
        replayId: record.replayId,
        timestamp: record.timestamp,
      },
    });

    const statusRelationshipType = record.status === "VERIFIED" ? "VERIFIED_BY" : "FAILED_BY";
    await graphRepository.createRelationship({
      fromId: record.decisionId,
      toId: record.replayId,
      type: statusRelationshipType,
      properties: {
        replayId: record.replayId,
        timestamp: record.timestamp,
      },
    });
  }
}

const DEFAULT_REPLAY_LEDGER_PATH = join(process.cwd(), "authority", "replay", "replay.jsonl");