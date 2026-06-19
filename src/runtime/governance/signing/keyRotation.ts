import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  AuthorityKeyDescriptor,
  AuthorityKeyManifest,
  TrustedAuthoritiesDocument,
  AUTHORITY_KEY_HASH_PATH,
  AUTHORITY_KEY_MANIFEST_PATH,
  TRUSTED_AUTHORITIES_PATH,
  loadAuthorityKeyManifest,
  loadTrustedAuthorities,
  persistAuthorityKeyManifest,
  persistTrustedAuthorities,
} from "./keyStore.js";

export interface RotateAuthorityKeyInput {
  authorityId: string;
  publicKey: string;
  reason: string;
  rotatedAt?: string;
}

export interface RotationLedgerRecord {
  rotationId: string;
  rotatedAt: string;
  replacedAuthorityId: string;
  replacementAuthorityId: string;
  reason: string;
}

export interface RotationPersistencePaths {
  manifestPath?: string;
  manifestHashPath?: string;
  trustedAuthoritiesPath?: string;
  rotationLedgerPath?: string;
}

export interface RotationResult {
  manifest: AuthorityKeyManifest;
  trustedAuthorities: TrustedAuthoritiesDocument;
  ledgerRecord: RotationLedgerRecord;
}

export const DEFAULT_AUTHORITY_ROTATION_LEDGER_PATH = join(
  process.cwd(),
  "authority",
  "signing",
  "authorityRotationLedger.jsonl",
);

export function rotateAuthorityKeyInMemory(
  currentManifest: AuthorityKeyManifest,
  currentTrusted: TrustedAuthoritiesDocument,
  input: RotateAuthorityKeyInput,
): RotationResult {
  if (input.authorityId.length === 0) {
    throw new Error("authorityId is required for key rotation");
  }

  if (input.publicKey.length === 0) {
    throw new Error("publicKey is required for key rotation");
  }

  if (input.reason.length === 0) {
    throw new Error("reason is required for key rotation");
  }

  const rotatedAt = input.rotatedAt ?? new Date().toISOString();
  const trustedById = new Map<string, AuthorityKeyDescriptor>();

  for (const authority of currentTrusted.authorities) {
    trustedById.set(authority.authorityId, {
      ...authority,
      status:
        authority.authorityId === currentManifest.authorityId && authority.status === "active"
          ? "retired"
          : authority.status,
      retiredAt:
        authority.authorityId === currentManifest.authorityId && authority.status === "active"
          ? rotatedAt
          : authority.retiredAt,
      validUntil:
        authority.authorityId === currentManifest.authorityId && authority.status === "active"
          ? rotatedAt
          : authority.validUntil,
    });
  }

  trustedById.set(currentManifest.authorityId, {
    ...currentManifest,
    status: "retired",
    retiredAt: rotatedAt,
    validUntil: rotatedAt,
  });

  const nextActiveAuthority: AuthorityKeyDescriptor = {
    authorityId: input.authorityId,
    algorithm: "ed25519",
    publicKey: input.publicKey,
    createdAt: rotatedAt,
    validFrom: rotatedAt,
    status: "active",
  };

  trustedById.set(input.authorityId, nextActiveAuthority);

  return {
    manifest: { ...nextActiveAuthority },
    trustedAuthorities: {
      updatedAt: rotatedAt,
      authorities: Array.from(trustedById.values()),
    },
    ledgerRecord: {
      rotationId: `rotation-${rotatedAt}`,
      rotatedAt,
      replacedAuthorityId: currentManifest.authorityId,
      replacementAuthorityId: input.authorityId,
      reason: input.reason,
    },
  };
}

export async function appendAuthorityRotationLedger(
  record: RotationLedgerRecord,
  path = DEFAULT_AUTHORITY_ROTATION_LEDGER_PATH,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(record)}\n`, "utf8");
}

export async function rotateAuthorityKey(
  input: RotateAuthorityKeyInput,
  paths?: RotationPersistencePaths,
): Promise<RotationResult> {
  const manifestPath = paths?.manifestPath ?? AUTHORITY_KEY_MANIFEST_PATH;
  const manifestHashPath = paths?.manifestHashPath ?? AUTHORITY_KEY_HASH_PATH;
  const trustedAuthoritiesPath = paths?.trustedAuthoritiesPath ?? TRUSTED_AUTHORITIES_PATH;
  const rotationLedgerPath = paths?.rotationLedgerPath ?? DEFAULT_AUTHORITY_ROTATION_LEDGER_PATH;

  const manifest = loadAuthorityKeyManifest(manifestPath, manifestHashPath);
  const trusted = loadTrustedAuthorities(trustedAuthoritiesPath);
  const rotated = rotateAuthorityKeyInMemory(manifest, trusted, input);
  persistAuthorityKeyManifest(rotated.manifest, manifestPath, manifestHashPath);
  persistTrustedAuthorities(rotated.trustedAuthorities, trustedAuthoritiesPath);
  await appendAuthorityRotationLedger(rotated.ledgerRecord, rotationLedgerPath);
  return rotated;
}
