import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { ReplayRecord } from "../service/replayRecord.js";
import { verifyReplay, ReplayVerificationResult } from "./verifyReplay.js";
import { verifyGovernance } from "./verifyGovernance.js";
import { verifyBuild } from "./verifyBuild.js";
import { verifyDeployment } from "./verifyDeployment.js";
import { verifyRuntime } from "./verifyRuntime.js";
import { VerificationReport } from "./verificationReport.js";
import { ReplaySegment, buildReplaySegments, computeMerkleRoot, loadReplaySegments, verifyReplaySegmentSignature } from "../replay/replaySegment.js";

export type VerificationMode = "full" | "checkpoint" | "merkle";

export interface VerificationOptions {
  mode?: VerificationMode;
  checkpointInterval?: number;
  segmentPath?: string;
}

export interface VerificationDependencies {
  verifyReplay: (record: ReplayRecord) => ReplayVerificationResult;
  verifyGovernance: (record: ReplayRecord) => Promise<boolean>;
  verifyBuild: (record: ReplayRecord) => boolean;
  verifyDeployment: (record: ReplayRecord) => boolean;
  verifyRuntime: (record: ReplayRecord) => boolean;
}

const DEFAULT_DEPENDENCIES: VerificationDependencies = {
  verifyReplay,
  verifyGovernance,
  verifyBuild,
  verifyDeployment,
  verifyRuntime,
};

export async function verifyArtifact(
  artifactPath: string,
  dependencies: Partial<VerificationDependencies> = {},
  options: VerificationOptions = {},
): Promise<VerificationReport> {
  const deps: VerificationDependencies = {
    ...DEFAULT_DEPENDENCIES,
    ...dependencies,
  };

  const mode = options.mode ?? "full";
  const checkpointInterval =
    typeof options.checkpointInterval === "number" && Number.isFinite(options.checkpointInterval) && options.checkpointInterval > 0
      ? Math.floor(options.checkpointInterval)
      : 5000;

  const loaded = await loadReplayArtifacts(artifactPath);

  if (loaded.records.length === 0) {
    throw new Error(`artifact '${artifactPath}' does not contain verifiable replay records`);
  }

  if (mode === "full") {
    return verifyFullLedger(loaded.records, loaded.parseIssues, artifactPath, deps);
  }

  const segments = await loadOrBuildSegments(loaded.records, options.segmentPath, checkpointInterval);

  if (mode === "checkpoint") {
    return verifyCheckpointLedger(loaded.records, loaded.parseIssues, artifactPath, deps, segments);
  }

  return verifyMerkleLedger(loaded.records, loaded.parseIssues, artifactPath, segments);
}

export async function verifyReplayArtifactRecord(
  record: ReplayRecord,
  artifactPath: string,
  dependencies: VerificationDependencies = DEFAULT_DEPENDENCIES,
): Promise<VerificationReport> {
  const issues: string[] = [];

  const replay = dependencies.verifyReplay(record);
  issues.push(...replay.issues);

  let governanceValid = false;
  try {
    governanceValid = await dependencies.verifyGovernance(record);
    if (!governanceValid) {
      issues.push("governance verification failed");
    }
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  }

  let buildValid = false;
  try {
    buildValid = dependencies.verifyBuild(record);
    if (!buildValid) {
      issues.push("build verification failed");
    }
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  }

  let deploymentValid = false;
  try {
    deploymentValid = dependencies.verifyDeployment(record);
    if (!deploymentValid) {
      issues.push("deployment verification failed");
    }
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  }

  let runtimeValid = false;
  try {
    runtimeValid = dependencies.verifyRuntime(record);
    if (!runtimeValid) {
      issues.push("runtime verification failed");
    }
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  }

  const trusted =
    replay.authorityValid &&
    replay.keyRegistered &&
    replay.signatureValid &&
    governanceValid &&
    buildValid &&
    deploymentValid &&
    runtimeValid &&
    replay.replayValid &&
    replay.proofValid;

  return {
    trusted,
    artifactPath: basename(artifactPath),
    authority: replay.authorityId,
    authorityValid: replay.authorityValid,
    keyRegistered: replay.keyRegistered,
    signatureValid: replay.signatureValid,
    governanceValid,
    buildValid,
    deploymentValid,
    runtimeValid,
    replayValid: replay.replayValid,
    proofValid: replay.proofValid,
    issues,
  };
}

async function loadReplayArtifacts(
  artifactPath: string,
): Promise<{ records: ReplayRecord[]; parseIssues: string[] }> {
  const raw = await readFile(artifactPath, "utf8");
  const trimmed = raw.trim();

  if (trimmed.length === 0) {
    throw new Error(`artifact '${artifactPath}' is empty`);
  }

  if (trimmed.startsWith("{")) {
    try {
      return { records: [JSON.parse(trimmed) as ReplayRecord], parseIssues: [] };
    } catch {
      // Fall through to JSONL first-line parsing.
    }
  }

  const records: ReplayRecord[] = [];
  const parseIssues: string[] = [];
  const lines = trimmed.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line.length === 0) {
      continue;
    }

    try {
      records.push(JSON.parse(line) as ReplayRecord);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      parseIssues.push(`line ${index + 1}: ${message}`);
    }
  }

  return { records, parseIssues };
}

async function verifyFullLedger(
  records: ReplayRecord[],
  parseIssues: string[],
  artifactPath: string,
  deps: VerificationDependencies,
): Promise<VerificationReport> {
  const reports = await Promise.all(
    records.map((record) => verifyReplayArtifactRecord(record, artifactPath, deps)),
  );

  const issues = [...parseIssues];
  for (let index = 0; index < reports.length; index += 1) {
    for (const issue of reports[index].issues) {
      issues.push(`record ${index + 1}: ${issue}`);
    }
  }

  const trusted = parseIssues.length === 0 && reports.every((report) => report.trusted);
  const base = reports[reports.length - 1];

  return {
    ...base,
    trusted,
    mode: "full",
    recordsAnalyzed: records.length,
    segmentsAnalyzed: Math.max(1, records.length),
    authority: resolveAuthoritySummary(reports),
    authorityValid: reports.every((report) => report.authorityValid),
    keyRegistered: reports.every((report) => report.keyRegistered),
    signatureValid: reports.every((report) => report.signatureValid),
    governanceValid: reports.every((report) => report.governanceValid),
    buildValid: reports.every((report) => report.buildValid),
    deploymentValid: reports.every((report) => report.deploymentValid),
    runtimeValid: reports.every((report) => report.runtimeValid),
    replayValid: reports.every((report) => report.replayValid),
    proofValid: reports.every((report) => report.proofValid),
    issues,
  };
}

async function verifyCheckpointLedger(
  records: ReplayRecord[],
  parseIssues: string[],
  artifactPath: string,
  deps: VerificationDependencies,
  segments: ReplaySegment[],
): Promise<VerificationReport> {
  const checkpointIndexes = segments.map((segment) => segment.checkpointRecordIndex);

  const checkpointReports = await Promise.all(
    checkpointIndexes.map((index) => verifyReplayArtifactRecord(records[index], artifactPath, deps)),
  );

  const segmentIntegrity = verifySegmentRoots(records, segments);
  const issues = [...parseIssues, ...segmentIntegrity.issues];
  checkpointReports.forEach((report, reportIndex) => {
    for (const issue of report.issues) {
      issues.push(`checkpoint ${reportIndex + 1}: ${issue}`);
    }
  });

  const base = checkpointReports[checkpointReports.length - 1];
  const checkpointTrusted =
    parseIssues.length === 0 &&
    segmentIntegrity.valid &&
    checkpointReports.every((report) => report.trusted);

  return {
    ...base,
    trusted: checkpointTrusted,
    mode: "checkpoint",
    recordsAnalyzed: records.length,
    segmentsAnalyzed: segments.length,
    authority: resolveAuthoritySummary(checkpointReports),
    authorityValid: checkpointReports.every((report) => report.authorityValid),
    keyRegistered: checkpointReports.every((report) => report.keyRegistered),
    signatureValid: checkpointReports.every((report) => report.signatureValid),
    governanceValid: checkpointReports.every((report) => report.governanceValid),
    buildValid: checkpointReports.every((report) => report.buildValid),
    deploymentValid: checkpointReports.every((report) => report.deploymentValid),
    runtimeValid: checkpointReports.every((report) => report.runtimeValid),
    replayValid: segmentIntegrity.valid && checkpointReports.every((report) => report.replayValid),
    proofValid: segmentIntegrity.valid && checkpointReports.every((report) => report.proofValid),
    issues,
  };
}

async function verifyMerkleLedger(
  records: ReplayRecord[],
  parseIssues: string[],
  artifactPath: string,
  segments: ReplaySegment[],
): Promise<VerificationReport> {
  const segmentIntegrity = verifySegmentRoots(records, segments);
  const minimalShapeValid = records.every(
    (record) =>
      typeof record.replayHash === "string" &&
      record.replayHash.length > 0 &&
      record.proof?.algorithm === "sha256",
  );

  const trusted = parseIssues.length === 0 && segmentIntegrity.valid && minimalShapeValid;
  const authoritySet = new Set(
    records.map((record) => record.signature?.authorityId ?? record.signature?.signerId ?? "unknown-authority"),
  );

  const issues = [...parseIssues, ...segmentIntegrity.issues];
  if (!minimalShapeValid) {
    issues.push("one or more records are missing replayHash/proof fields required for merkle mode");
  }

  return {
    trusted,
    artifactPath: basename(artifactPath),
    mode: "merkle",
    recordsAnalyzed: records.length,
    segmentsAnalyzed: segments.length,
    authority: authoritySet.size === 1 ? Array.from(authoritySet)[0] : "mixed-authority",
    authorityValid: trusted,
    keyRegistered: trusted,
    signatureValid: trusted,
    governanceValid: true,
    buildValid: true,
    deploymentValid: true,
    runtimeValid: true,
    replayValid: trusted,
    proofValid: trusted,
    issues,
  };
}

function verifySegmentRoots(
  records: ReplayRecord[],
  segments: ReplaySegment[],
): { valid: boolean; issues: string[] } {
  const issues: string[] = [];

  for (const segment of segments) {
    if (!verifyReplaySegmentSignature(segment)) {
      issues.push(`segment '${segment.segmentId}' signature verification failed`);
      continue;
    }

    if (segment.checkpointRecordIndex < 0 || segment.checkpointRecordIndex >= records.length) {
      issues.push(`segment '${segment.segmentId}' checkpointRecordIndex is out of range`);
      continue;
    }

    const [startRaw, endRaw] = segment.segmentId.replace("segment-", "").split("-");
    const start = Number(startRaw) - 1;
    const end = Number(endRaw) - 1;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || end >= records.length) {
      issues.push(`segment '${segment.segmentId}' has invalid event range`);
      continue;
    }

    const scoped = records.slice(start, end + 1);
    const recomputedRoot = computeMerkleRoot(scoped.map((record) => record.replayHash));
    if (recomputedRoot !== segment.merkleRoot) {
      issues.push(`segment '${segment.segmentId}' merkle root mismatch`);
    }

    const checkpointRecord = records[segment.checkpointRecordIndex];
    if (checkpointRecord.replayHash !== segment.checkpointHash) {
      issues.push(`segment '${segment.segmentId}' checkpoint hash mismatch`);
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

function resolveAuthoritySummary(reports: VerificationReport[]): string {
  const authorities = new Set(reports.map((report) => report.authority));
  return authorities.size === 1 ? Array.from(authorities)[0] : "mixed-authority";
}

async function loadOrBuildSegments(
  records: ReplayRecord[],
  segmentPath: string | undefined,
  checkpointInterval: number,
): Promise<ReplaySegment[]> {
  if (segmentPath) {
    const loaded = await loadReplaySegments(segmentPath);
    if (loaded.length > 0) {
      return loaded;
    }
  }

  return buildReplaySegments(records, checkpointInterval);
}
