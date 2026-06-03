import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BuildSnapshot } from "./buildSnapshot.js";

interface BuildManifest {
  runtimeVersion: string;
  gitCommit: string;
  buildTimestamp: string;
  worktreeDirty: boolean;
}

const DEFAULT_BUILD_MANIFEST_PATH = join(process.cwd(), "authority", "build", "buildManifest.json");
const DEFAULT_BUILD_HASH_PATH = join(process.cwd(), "authority", "build", "build.hash");
const DEFAULT_PACKAGE_PATH = join(process.cwd(), "package.json");

export function loadBuildSnapshot(
  manifestPath = DEFAULT_BUILD_MANIFEST_PATH,
  hashPath = DEFAULT_BUILD_HASH_PATH,
  packagePath = DEFAULT_PACKAGE_PATH,
): BuildSnapshot {
  const manifestRaw = readFileSync(manifestPath, "utf8");
  const expectedBuildHash = readFileSync(hashPath, "utf8").trim();
  const buildHash = createHash("sha256").update(manifestRaw).digest("hex");

  if (buildHash !== expectedBuildHash) {
    throw new Error("Build manifest hash verification failed");
  }

  const manifest = parseBuildManifest(manifestRaw);
  const packageVersion = parsePackageVersion(readFileSync(packagePath, "utf8"));
  if (manifest.runtimeVersion !== packageVersion) {
    throw new Error("Build manifest runtimeVersion does not match package.json version");
  }

  return {
    runtimeVersion: manifest.runtimeVersion,
    gitCommit: manifest.gitCommit,
    buildHash,
    buildTimestamp: manifest.buildTimestamp,
    worktreeDirty: manifest.worktreeDirty,
    manifestPath,
    loadedAt: new Date().toISOString(),
  };
}

function parseBuildManifest(raw: string): BuildManifest {
  const parsed = JSON.parse(raw) as Partial<BuildManifest>;

  if (typeof parsed.runtimeVersion !== "string" || parsed.runtimeVersion.trim().length === 0) {
    throw new Error("Build manifest requires runtimeVersion");
  }

  if (typeof parsed.gitCommit !== "string" || parsed.gitCommit.trim().length === 0) {
    throw new Error("Build manifest requires gitCommit");
  }

  if (typeof parsed.buildTimestamp !== "string" || parsed.buildTimestamp.trim().length === 0) {
    throw new Error("Build manifest requires buildTimestamp");
  }

  if (typeof parsed.worktreeDirty !== "boolean") {
    throw new Error("Build manifest requires worktreeDirty");
  }

  return {
    runtimeVersion: parsed.runtimeVersion.trim(),
    gitCommit: parsed.gitCommit.trim(),
    buildTimestamp: parsed.buildTimestamp.trim(),
    worktreeDirty: parsed.worktreeDirty,
  };
}

function parsePackageVersion(raw: string): string {
  const parsed = JSON.parse(raw) as { version?: unknown };
  if (typeof parsed.version !== "string" || parsed.version.trim().length === 0) {
    throw new Error("package.json requires version for build provenance");
  }

  return parsed.version.trim();
}