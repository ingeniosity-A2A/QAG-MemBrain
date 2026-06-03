import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { SigningAlgorithm } from "./signingAlgorithm.js";

export type AuthorityKeyStatus = "active" | "retired" | "revoked";

export interface AuthorityKeyDescriptor {
  authorityId: string;
  algorithm: SigningAlgorithm;
  publicKey: string;
  createdAt: string;
  validFrom: string;
  validUntil?: string;
  status: AuthorityKeyStatus;
  retiredAt?: string;
  revokedAt?: string;
}

export interface AuthorityKeyManifest extends AuthorityKeyDescriptor {}

export interface TrustedAuthoritiesDocument {
  updatedAt: string;
  authorities: AuthorityKeyDescriptor[];
}

const AUTHORITY_SIGNING_DIR = join(process.cwd(), "authority", "signing");
export const AUTHORITY_KEY_MANIFEST_PATH = join(AUTHORITY_SIGNING_DIR, "authorityKeyManifest.json");
export const AUTHORITY_KEY_HASH_PATH = join(AUTHORITY_SIGNING_DIR, "authorityKey.hash");
export const TRUSTED_AUTHORITIES_PATH = join(AUTHORITY_SIGNING_DIR, "trustedAuthorities.json");

export function computeAuthorityManifestHash(manifestContent: string): string {
  return createHash("sha256").update(manifestContent, "utf8").digest("hex");
}

export function loadAuthorityKeyManifest(
  path = AUTHORITY_KEY_MANIFEST_PATH,
  hashPath = AUTHORITY_KEY_HASH_PATH,
): AuthorityKeyManifest {
  if (!existsSync(path)) {
    throw new Error(`authority key manifest not found at '${path}'. Run 'ava007 trust bootstrap'.`);
  }

  const manifestContent = readFileSync(path, "utf8");
  if (!existsSync(hashPath)) {
    throw new Error(`authority key hash not found at '${hashPath}'`);
  }

  const expectedHash = readFileSync(hashPath, "utf8").trim();
  const actualHash = computeAuthorityManifestHash(manifestContent);
  if (expectedHash.length === 0 || expectedHash !== actualHash) {
    throw new Error("authority key manifest hash verification failed");
  }

  const parsed = JSON.parse(manifestContent) as AuthorityKeyManifest;
  assertAuthorityDescriptor(parsed, "authority key manifest");
  return parsed;
}

export function persistAuthorityKeyManifest(
  manifest: AuthorityKeyManifest,
  path = AUTHORITY_KEY_MANIFEST_PATH,
  hashPath = AUTHORITY_KEY_HASH_PATH,
): void {
  assertAuthorityDescriptor(manifest, "authority key manifest");
  mkdirSync(dirname(path), { recursive: true });
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(path, serialized, "utf8");
  mkdirSync(dirname(hashPath), { recursive: true });
  writeFileSync(hashPath, `${computeAuthorityManifestHash(serialized)}\n`, "utf8");
}

export function loadTrustedAuthorities(path = TRUSTED_AUTHORITIES_PATH): TrustedAuthoritiesDocument {
  if (!existsSync(path)) {
    const manifest = loadAuthorityKeyManifest();
    return {
      updatedAt: new Date().toISOString(),
      authorities: [{ ...manifest }],
    };
  }

  const parsed = JSON.parse(readFileSync(path, "utf8")) as TrustedAuthoritiesDocument;
  if (typeof parsed.updatedAt !== "string" || parsed.updatedAt.length === 0) {
    throw new Error("trusted authorities requires updatedAt");
  }

  if (!Array.isArray(parsed.authorities)) {
    throw new Error("trusted authorities requires authorities array");
  }

  parsed.authorities.forEach((entry, index) => {
    assertAuthorityDescriptor(entry, `trusted authorities[${index}]`);
  });

  return parsed;
}

export function persistTrustedAuthorities(
  trustedAuthorities: TrustedAuthoritiesDocument,
  path = TRUSTED_AUTHORITIES_PATH,
): void {
  if (typeof trustedAuthorities.updatedAt !== "string" || trustedAuthorities.updatedAt.length === 0) {
    throw new Error("trusted authorities requires updatedAt");
  }

  if (!Array.isArray(trustedAuthorities.authorities)) {
    throw new Error("trusted authorities requires authorities array");
  }

  trustedAuthorities.authorities.forEach((entry, index) => {
    assertAuthorityDescriptor(entry, `trusted authorities[${index}]`);
  });

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(trustedAuthorities, null, 2)}\n`, "utf8");
}

function assertAuthorityDescriptor(value: AuthorityKeyDescriptor, label: string): void {
  if (typeof value.authorityId !== "string" || value.authorityId.length === 0) {
    throw new Error(`${label} requires authorityId`);
  }

  if (value.algorithm !== "ed25519") {
    throw new Error(`${label} requires ed25519 algorithm`);
  }

  if (typeof value.publicKey !== "string" || value.publicKey.length === 0) {
    throw new Error(`${label} requires publicKey`);
  }

  if (typeof value.createdAt !== "string" || value.createdAt.length === 0) {
    throw new Error(`${label} requires createdAt`);
  }

  if (typeof value.validFrom !== "string" || value.validFrom.length === 0) {
    throw new Error(`${label} requires validFrom`);
  }

  const validFromMs = Date.parse(value.validFrom);
  if (Number.isNaN(validFromMs)) {
    throw new Error(`${label} requires validFrom to be an ISO timestamp`);
  }

  if (typeof value.validUntil !== "undefined") {
    const validUntilMs = Date.parse(value.validUntil);
    if (Number.isNaN(validUntilMs)) {
      throw new Error(`${label} requires validUntil to be an ISO timestamp`);
    }

    if (validUntilMs < validFromMs) {
      throw new Error(`${label} requires validUntil to be >= validFrom`);
    }
  }

  if (value.status !== "active" && value.status !== "retired" && value.status !== "revoked") {
    throw new Error(`${label} requires status to be active, retired, or revoked`);
  }
}
