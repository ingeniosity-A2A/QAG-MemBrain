import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { ReplayRecord } from "../service/replayRecord.js";
import { verifyReplay, ReplayVerificationResult } from "./verifyReplay.js";
import { verifyGovernance } from "./verifyGovernance.js";
import { verifyBuild } from "./verifyBuild.js";
import { verifyDeployment } from "./verifyDeployment.js";
import { verifyRuntime } from "./verifyRuntime.js";
import { VerificationReport } from "./verificationReport.js";

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
): Promise<VerificationReport> {
  const deps: VerificationDependencies = {
    ...DEFAULT_DEPENDENCIES,
    ...dependencies,
  };

  const replayRecord = await loadReplayArtifact(artifactPath);
  return verifyReplayArtifactRecord(replayRecord, artifactPath, deps);
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

async function loadReplayArtifact(artifactPath: string): Promise<ReplayRecord> {
  const raw = await readFile(artifactPath, "utf8");
  const trimmed = raw.trim();

  if (trimmed.length === 0) {
    throw new Error(`artifact '${artifactPath}' is empty`);
  }

  if (trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed) as ReplayRecord;
    } catch {
      // Fall through to JSONL first-line parsing.
    }
  }

  const firstLine = trimmed
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (!firstLine) {
    throw new Error(`artifact '${artifactPath}' does not contain JSON`);
  }

  return JSON.parse(firstLine) as ReplayRecord;
}
