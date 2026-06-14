import { randomUUID } from "node:crypto";

export interface DIDPublicKey {
  keyId: string;
  algorithm: "ed25519" | "rsa";
  publicKeyPem: string;
  createdAt: string;
  revokedAt?: string;
}

export interface DIDDocument {
  id: string;
  publicKeys: DIDPublicKey[];
  createdAt: string;
  updatedAt: string;
}

export class InMemoryDIDRegistry {
  private readonly docs = new Map<string, DIDDocument>();

  createDID(input: { id?: string; algorithm: "ed25519" | "rsa"; publicKeyPem: string; timestamp?: string }): DIDDocument {
    const timestamp = input.timestamp ?? new Date().toISOString();
    const id = input.id ?? `did:ava:${randomUUID()}`;

    if (this.docs.has(id)) {
      throw new Error(`DID already exists: ${id}`);
    }

    const doc: DIDDocument = {
      id,
      publicKeys: [
        {
          keyId: `${id}#key-1`,
          algorithm: input.algorithm,
          publicKeyPem: input.publicKeyPem,
          createdAt: timestamp,
        },
      ],
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.docs.set(id, doc);
    return cloneDocument(doc);
  }

  resolveDID(id: string): DIDDocument | null {
    const doc = this.docs.get(id);
    return doc ? cloneDocument(doc) : null;
  }

  rotateKey(id: string, input: { algorithm: "ed25519" | "rsa"; publicKeyPem: string; timestamp?: string }): DIDDocument {
    const timestamp = input.timestamp ?? new Date().toISOString();
    const doc = this.docs.get(id);
    if (!doc) {
      throw new Error(`Unknown DID: ${id}`);
    }

    const nextIndex = doc.publicKeys.length + 1;
    const rotated: DIDDocument = {
      ...doc,
      publicKeys: [
        ...doc.publicKeys,
        {
          keyId: `${id}#key-${nextIndex}`,
          algorithm: input.algorithm,
          publicKeyPem: input.publicKeyPem,
          createdAt: timestamp,
        },
      ],
      updatedAt: timestamp,
    };

    this.docs.set(id, rotated);
    return cloneDocument(rotated);
  }

  revokeKey(id: string, keyId: string, timestamp = new Date().toISOString()): DIDDocument {
    const doc = this.docs.get(id);
    if (!doc) {
      throw new Error(`Unknown DID: ${id}`);
    }

    const keyExists = doc.publicKeys.some((key) => key.keyId === keyId);
    if (!keyExists) {
      throw new Error(`Unknown key for DID ${id}: ${keyId}`);
    }

    const updated: DIDDocument = {
      ...doc,
      publicKeys: doc.publicKeys.map((key) =>
        key.keyId === keyId
          ? {
              ...key,
              revokedAt: timestamp,
            }
          : key,
      ),
      updatedAt: timestamp,
    };

    this.docs.set(id, updated);
    return cloneDocument(updated);
  }

  activeKeys(id: string): DIDPublicKey[] {
    const doc = this.docs.get(id);
    if (!doc) {
      return [];
    }

    return doc.publicKeys.filter((key) => !key.revokedAt).map((key) => ({ ...key }));
  }
}

function cloneDocument(doc: DIDDocument): DIDDocument {
  return {
    ...doc,
    publicKeys: doc.publicKeys.map((key) => ({ ...key })),
  };
}
