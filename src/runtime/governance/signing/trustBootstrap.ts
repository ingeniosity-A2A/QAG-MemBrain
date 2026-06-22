import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  AuthorityKeyDescriptor,
  AuthorityKeyManifest,
  TrustedAuthoritiesDocument,
  persistAuthorityKeyManifest,
  persistTrustedAuthorities,
} from "./keyStore.js";
import { DEFAULT_LOCAL_SIGNER_PRIVATE_KEY_PATH, generateEd25519KeyPair } from "./signer.js";

export interface AuthorityBootstrapEntry {
  authorityId: string;
  activatedAt: string;
  expiresAt?: string;
}

export interface BootstrappedAuthority {
  descriptor: AuthorityKeyDescriptor;
  privateKeyPem: string;
}

export interface BootstrapAuthorityTrustRootResult {
  manifest: AuthorityKeyManifest;
  trustedAuthorities: TrustedAuthoritiesDocument;
  generated: BootstrappedAuthority[];
  activePrivateKeyPath: string;
}

export function bootstrapAuthorityTrustRoot(
  entries: AuthorityBootstrapEntry[],
  options?: {
    privateKeyPath?: string;
    manifestPath?: string;
    manifestHashPath?: string;
    trustedAuthoritiesPath?: string;
  },
): BootstrapAuthorityTrustRootResult {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error("authority trust bootstrap requires at least one authority entry");
  }

  const generated: BootstrappedAuthority[] = entries.map((entry, index) => {
    if (typeof entry.authorityId !== "string" || entry.authorityId.length === 0) {
      throw new Error(`authority entry[${index}] requires authorityId`);
    }

    const activatedAtMs = Date.parse(entry.activatedAt);
    if (typeof entry.activatedAt !== "string" || Number.isNaN(activatedAtMs)) {
      throw new Error(`authority entry[${index}] requires activatedAt ISO timestamp`);
    }

    if (typeof entry.expiresAt !== "undefined") {
      const expiresAtMs = Date.parse(entry.expiresAt);
      if (Number.isNaN(expiresAtMs) || expiresAtMs < activatedAtMs) {
        throw new Error(`authority entry[${index}] requires expiresAt >= activatedAt`);
      }
    }

    const keys = generateEd25519KeyPair();
    const isLast = index === entries.length - 1;

    const descriptor: AuthorityKeyDescriptor = {
      authorityId: entry.authorityId,
      algorithm: "ed25519",
      publicKey: keys.publicKey,
      createdAt: entry.activatedAt,
      validFrom: entry.activatedAt,
      validUntil: entry.expiresAt,
      status: isLast ? "active" : "retired",
      retiredAt: isLast ? undefined : entry.expiresAt ?? entry.activatedAt,
    };

    return {
      descriptor,
      privateKeyPem: keys.privateKey,
    };
  });

  const active = generated[generated.length - 1];
  const now = new Date().toISOString();

  const manifest: AuthorityKeyManifest = {
    ...active.descriptor,
    status: "active",
  };

  const trustedAuthorities: TrustedAuthoritiesDocument = {
    updatedAt: now,
    authorities: generated.map((entry) => entry.descriptor),
  };

  persistAuthorityKeyManifest(manifest, options?.manifestPath, options?.manifestHashPath);
  persistTrustedAuthorities(trustedAuthorities, options?.trustedAuthoritiesPath);

  const privateKeyPath = options?.privateKeyPath ?? DEFAULT_LOCAL_SIGNER_PRIVATE_KEY_PATH;
  mkdirSync(dirname(privateKeyPath), { recursive: true });
  writeFileSync(privateKeyPath, active.privateKeyPem, "utf8");

  return {
    manifest,
    trustedAuthorities,
    generated,
    activePrivateKeyPath: privateKeyPath,
  };
}
