import {
  AuthorityKeyDescriptor,
  AuthorityKeyManifest,
  TrustedAuthoritiesDocument,
  loadAuthorityKeyManifest,
  loadTrustedAuthorities,
} from "./keyStore.js";

export interface AuthoritySignerRegistry {
  activeAuthority: AuthorityKeyDescriptor;
  trustedAuthorities: AuthorityKeyDescriptor[];
  resolveAuthority(authorityId: string): AuthorityKeyDescriptor | null;
  resolvePublicKey(authorityId: string): string | null;
  isAuthorityValidAt(authorityId: string, signedAt: string): boolean;
}

export function buildAuthoritySignerRegistry(
  manifest: AuthorityKeyManifest,
  trusted: TrustedAuthoritiesDocument,
): AuthoritySignerRegistry {
  const trustedById = new Map<string, AuthorityKeyDescriptor>();

  for (const authority of trusted.authorities) {
    trustedById.set(authority.authorityId, { ...authority });
  }

  if (!trustedById.has(manifest.authorityId)) {
    trustedById.set(manifest.authorityId, { ...manifest });
  }

  const activeAuthority = trustedById.get(manifest.authorityId);
  if (!activeAuthority) {
    throw new Error(`missing active authority '${manifest.authorityId}'`);
  }

  if (activeAuthority.status === "revoked") {
    throw new Error(`active authority '${manifest.authorityId}' cannot be revoked`);
  }

  return {
    activeAuthority: {
      ...activeAuthority,
      status: "active",
    },
    trustedAuthorities: Array.from(trustedById.values()),
    resolveAuthority(authorityId: string): AuthorityKeyDescriptor | null {
      const authority = trustedById.get(authorityId);
      return authority ? { ...authority } : null;
    },
    resolvePublicKey(authorityId: string): string | null {
      const authority = trustedById.get(authorityId);
      if (!authority || authority.status === "revoked" || authority.publicKey.length === 0) {
        return null;
      }

      return authority.publicKey;
    },
    isAuthorityValidAt(authorityId: string, signedAt: string): boolean {
      const authority = trustedById.get(authorityId);
      if (!authority || authority.status === "revoked") {
        return false;
      }

      const signedAtMs = Date.parse(signedAt);
      const validFromMs = Date.parse(authority.validFrom);
      if (Number.isNaN(signedAtMs) || Number.isNaN(validFromMs) || signedAtMs < validFromMs) {
        return false;
      }

      if (typeof authority.validUntil === "string") {
        const validUntilMs = Date.parse(authority.validUntil);
        if (Number.isNaN(validUntilMs) || signedAtMs > validUntilMs) {
          return false;
        }
      }

      return true;
    },
  };
}

export function loadAuthoritySignerRegistry(): AuthoritySignerRegistry {
  const manifest = loadAuthorityKeyManifest();
  const trusted = loadTrustedAuthorities();
  return buildAuthoritySignerRegistry(manifest, trusted);
}
