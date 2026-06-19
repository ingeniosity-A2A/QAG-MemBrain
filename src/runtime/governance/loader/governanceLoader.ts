import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { AuthorityLayer } from "../../authority/replay/replayContract.js";
import { GovernanceSnapshot } from "./governanceSnapshot.js";

interface GovernanceManifest {
  governanceVersion: string;
  authorityOrder: AuthorityLayer[];
  packageRoot: string;
}

interface GovernanceAttestation {
  governanceVersion: string;
  manifestHash: string;
  governanceHash: string;
  authorityOrder: AuthorityLayer[];
  createdAt: string;
  issuer: string;
}

const DEFAULT_MANIFEST_PATH = join(process.cwd(), "governance", "manifest.json");
const DEFAULT_MANIFEST_HASH_PATH = join(process.cwd(), "governance", "manifest.hash");
const DEFAULT_ATTESTATION_PATH = join(process.cwd(), "governance", "attestation.json");
const DEFAULT_ATTESTATION_HASH_PATH = join(process.cwd(), "governance", "attestation.hash");

export async function loadGovernanceSnapshot(
  manifestPath = DEFAULT_MANIFEST_PATH,
  manifestHashPath = DEFAULT_MANIFEST_HASH_PATH,
  attestationPath = DEFAULT_ATTESTATION_PATH,
  attestationHashPath = DEFAULT_ATTESTATION_HASH_PATH,
): Promise<GovernanceSnapshot> {
  const manifestRaw = await readFile(manifestPath, "utf8");
  const expectedManifestHash = (await readFile(manifestHashPath, "utf8")).trim();
  const manifestHash = createHash("sha256").update(manifestRaw).digest("hex");

  if (manifestHash !== expectedManifestHash) {
    throw new Error("Governance manifest hash verification failed");
  }

  const manifest = parseManifest(manifestRaw);
  const packageRootPath = join(dirname(manifestPath), manifest.packageRoot);
  const governanceHash = await computeGovernancePackageHash(packageRootPath);
  const attestationRaw = await readFile(attestationPath, "utf8");
  const expectedAttestationHash = (await readFile(attestationHashPath, "utf8")).trim();
  const attestationHash = createHash("sha256").update(attestationRaw).digest("hex");

  if (attestationHash !== expectedAttestationHash) {
    throw new Error("Governance attestation hash verification failed");
  }

  const attestation = parseAttestation(attestationRaw);
  assertAttestationMatches(attestation, {
    governanceVersion: manifest.governanceVersion,
    manifestHash,
    governanceHash,
    authorityOrder: manifest.authorityOrder,
  });

  return {
    governanceVersion: manifest.governanceVersion,
    governanceHash,
    manifestHash,
    attestationHash,
    authorityOrder: [...manifest.authorityOrder],
    sourcePath: packageRootPath,
    manifestPath,
    attestationPath,
    loadedAt: new Date().toISOString(),
  };
}

function parseManifest(raw: string): GovernanceManifest {
  const parsed = JSON.parse(raw) as Partial<GovernanceManifest>;

  if (typeof parsed.governanceVersion !== "string" || parsed.governanceVersion.trim().length === 0) {
    throw new Error("Governance manifest requires governanceVersion");
  }

  if (typeof parsed.packageRoot !== "string" || parsed.packageRoot.trim().length === 0) {
    throw new Error("Governance manifest requires packageRoot");
  }

  if (!Array.isArray(parsed.authorityOrder)) {
    throw new Error("Governance manifest requires authorityOrder");
  }

  const authorityLayers: AuthorityLayer[] = ["JSONL", "Tashi", "Neo4j", "GSAP", "Runtime"];
  if (
    parsed.authorityOrder.length !== authorityLayers.length ||
    parsed.authorityOrder.some((layer, idx) => layer !== authorityLayers[idx])
  ) {
    throw new Error("Governance manifest authorityOrder does not match canonical order");
  }

  return {
    governanceVersion: parsed.governanceVersion.trim(),
    authorityOrder: [...parsed.authorityOrder],
    packageRoot: parsed.packageRoot.trim(),
  };
}

function parseAttestation(raw: string): GovernanceAttestation {
  const parsed = JSON.parse(raw) as Partial<GovernanceAttestation>;

  if (typeof parsed.governanceVersion !== "string" || parsed.governanceVersion.trim().length === 0) {
    throw new Error("Governance attestation requires governanceVersion");
  }

  if (typeof parsed.manifestHash !== "string" || parsed.manifestHash.trim().length === 0) {
    throw new Error("Governance attestation requires manifestHash");
  }

  if (typeof parsed.governanceHash !== "string" || parsed.governanceHash.trim().length === 0) {
    throw new Error("Governance attestation requires governanceHash");
  }

  if (!Array.isArray(parsed.authorityOrder)) {
    throw new Error("Governance attestation requires authorityOrder");
  }

  if (typeof parsed.createdAt !== "string" || parsed.createdAt.trim().length === 0) {
    throw new Error("Governance attestation requires createdAt");
  }

  if (typeof parsed.issuer !== "string" || parsed.issuer.trim().length === 0) {
    throw new Error("Governance attestation requires issuer");
  }

  return {
    governanceVersion: parsed.governanceVersion.trim(),
    manifestHash: parsed.manifestHash.trim(),
    governanceHash: parsed.governanceHash.trim(),
    authorityOrder: [...parsed.authorityOrder],
    createdAt: parsed.createdAt.trim(),
    issuer: parsed.issuer.trim(),
  };
}

function assertAttestationMatches(
  attestation: GovernanceAttestation,
  expected: Pick<GovernanceAttestation, "governanceVersion" | "manifestHash" | "governanceHash" | "authorityOrder">,
): void {
  if (attestation.governanceVersion !== expected.governanceVersion) {
    throw new Error("Governance attestation version does not match manifest");
  }

  if (attestation.manifestHash !== expected.manifestHash) {
    throw new Error("Governance attestation manifest hash does not match verified manifest");
  }

  if (attestation.governanceHash !== expected.governanceHash) {
    throw new Error(
      `Governance attestation governance hash does not match verified governance package: attested=${attestation.governanceHash} expected=${expected.governanceHash}`,
    );
  }

  if (
    attestation.authorityOrder.length !== expected.authorityOrder.length ||
    attestation.authorityOrder.some((layer, idx) => layer !== expected.authorityOrder[idx])
  ) {
    throw new Error("Governance attestation authority order does not match manifest");
  }
}

async function computeGovernancePackageHash(rootPath: string): Promise<string> {
  const files = await listFiles(rootPath);
  const digest = createHash("sha256");

  for (const filePath of files) {
    const content = await readFile(filePath);
    const fileHash = createHash("sha256").update(content).digest("hex");
    const relPath = relative(rootPath, filePath).replaceAll("\\", "/");
    digest.update(`${relPath}:${fileHash}\n`);
  }

  return digest.digest("hex");
}

async function listFiles(rootPath: string): Promise<string[]> {
  const entries = await readdir(rootPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(rootPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(fullPath)));
    } else {
      files.push(fullPath);
    }
  }

  files.sort((a, b) => a.localeCompare(b));
  return files;
}