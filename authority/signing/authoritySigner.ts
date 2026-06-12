import { createPrivateKey, createPublicKey, sign as signBuffer } from "node:crypto";
import { DEFAULT_SIGNING_ALGORITHM, SigningAlgorithm } from "./signingAlgorithm.js";

export type AuthoritySignerBackend = "local" | "kms" | "hsm";

export interface AuthoritySigner {
  readonly backend: AuthoritySignerBackend;
  readonly algorithm: SigningAlgorithm;
  getAuthorityId(): string;
  getSignerId(): string;
  getPublicKey(): string | undefined;
  sign(data: Uint8Array): string;
}

export interface LocalAuthoritySignerInput {
  authorityId: string;
  signerId: string;
  privateKeyPem: string;
  publicKeyPem?: string;
}

export class LocalAuthoritySigner implements AuthoritySigner {
  readonly backend: AuthoritySignerBackend = "local";
  readonly algorithm: SigningAlgorithm = DEFAULT_SIGNING_ALGORITHM;
  private readonly publicKeyPem: string;

  constructor(private readonly input: LocalAuthoritySignerInput) {
    const privateKey = createPrivateKey(input.privateKeyPem);
    this.publicKeyPem =
      input.publicKeyPem ?? createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString();
  }

  getAuthorityId(): string {
    return this.input.authorityId;
  }

  getSignerId(): string {
    return this.input.signerId;
  }

  getPublicKey(): string {
    return this.publicKeyPem;
  }

  getPrivateKey(): string {
    return this.input.privateKeyPem;
  }

  sign(data: Uint8Array): string {
    const privateKey = createPrivateKey(this.input.privateKeyPem);
    return signBuffer(null, data, privateKey).toString("base64");
  }
}

export interface ExternalAuthoritySignerInput {
  authorityId: string;
  signerId: string;
  publicKeyPem: string;
  keyRef: string;
}

export class KmsAuthoritySigner implements AuthoritySigner {
  readonly backend: AuthoritySignerBackend = "kms";
  readonly algorithm: SigningAlgorithm = DEFAULT_SIGNING_ALGORITHM;

  constructor(private readonly input: ExternalAuthoritySignerInput) {}

  getAuthorityId(): string {
    return this.input.authorityId;
  }

  getSignerId(): string {
    return this.input.signerId;
  }

  getPublicKey(): string {
    return this.input.publicKeyPem;
  }

  sign(_data: Uint8Array): string {
    throw new Error(
      `KMS signer '${this.input.keyRef}' is not implemented yet. Configure a KMS adapter in Sprint 12C.`,
    );
  }
}

export class HsmAuthoritySigner implements AuthoritySigner {
  readonly backend: AuthoritySignerBackend = "hsm";
  readonly algorithm: SigningAlgorithm = DEFAULT_SIGNING_ALGORITHM;

  constructor(private readonly input: ExternalAuthoritySignerInput) {}

  getAuthorityId(): string {
    return this.input.authorityId;
  }

  getSignerId(): string {
    return this.input.signerId;
  }

  getPublicKey(): string {
    return this.input.publicKeyPem;
  }

  sign(_data: Uint8Array): string {
    throw new Error(
      `HSM signer '${this.input.keyRef}' is not implemented yet. Configure an HSM adapter in Sprint 12C.`,
    );
  }
}
