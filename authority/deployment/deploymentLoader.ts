import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DeploymentSnapshot } from "./deploymentSnapshot.js";

interface DeploymentManifest {
  deploymentVersion: string;
  environment: string;
  buildHash: string;
  releaseId: string;
  containerHash: string;
  deployedAt: string;
}

const DEFAULT_DEPLOYMENT_MANIFEST_PATH = join(process.cwd(), "authority", "deployment", "deploymentManifest.json");
const DEFAULT_DEPLOYMENT_HASH_PATH = join(process.cwd(), "authority", "deployment", "deployment.hash");

export function loadDeploymentSnapshot(
  expectedBuildHash: string,
  manifestPath = DEFAULT_DEPLOYMENT_MANIFEST_PATH,
  hashPath = DEFAULT_DEPLOYMENT_HASH_PATH,
): DeploymentSnapshot {
  const manifestRaw = readFileSync(manifestPath, "utf8");
  const expectedDeploymentHash = readFileSync(hashPath, "utf8").trim();
  const deploymentHash = createHash("sha256").update(manifestRaw).digest("hex");

  if (deploymentHash !== expectedDeploymentHash) {
    throw new Error("Deployment manifest hash verification failed");
  }

  const manifest = parseDeploymentManifest(manifestRaw);
  if (manifest.buildHash !== expectedBuildHash) {
    throw new Error("Deployment manifest buildHash does not match build provenance hash");
  }

  return {
    deploymentVersion: manifest.deploymentVersion,
    deploymentHash,
    releaseId: manifest.releaseId,
    environment: manifest.environment,
    buildHash: manifest.buildHash,
    containerHash: manifest.containerHash,
    deployedAt: manifest.deployedAt,
    manifestPath,
    loadedAt: new Date().toISOString(),
  };
}

function parseDeploymentManifest(raw: string): DeploymentManifest {
  const parsed = JSON.parse(raw) as Partial<DeploymentManifest>;

  if (typeof parsed.deploymentVersion !== "string" || parsed.deploymentVersion.trim().length === 0) {
    throw new Error("Deployment manifest requires deploymentVersion");
  }

  if (typeof parsed.environment !== "string" || parsed.environment.trim().length === 0) {
    throw new Error("Deployment manifest requires environment");
  }

  if (typeof parsed.buildHash !== "string" || parsed.buildHash.trim().length === 0) {
    throw new Error("Deployment manifest requires buildHash");
  }

  if (typeof parsed.releaseId !== "string" || parsed.releaseId.trim().length === 0) {
    throw new Error("Deployment manifest requires releaseId");
  }

  if (typeof parsed.containerHash !== "string" || parsed.containerHash.trim().length === 0) {
    throw new Error("Deployment manifest requires containerHash");
  }

  if (typeof parsed.deployedAt !== "string" || parsed.deployedAt.trim().length === 0) {
    throw new Error("Deployment manifest requires deployedAt");
  }

  return {
    deploymentVersion: parsed.deploymentVersion.trim(),
    environment: parsed.environment.trim(),
    buildHash: parsed.buildHash.trim(),
    releaseId: parsed.releaseId.trim(),
    containerHash: parsed.containerHash.trim(),
    deployedAt: parsed.deployedAt.trim(),
  };
}