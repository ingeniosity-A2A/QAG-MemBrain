import { createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID, sign as signBuffer } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_SIGNING_ALGORITHM } from "./signingAlgorithm.js";
import { ReplayArtifactRoot, SignatureRecord } from "./signatureRecord.js";
import { computeReplayArtifactHash } from "./signatureHash.js";
import { loadAuthoritySignerRegistry } from "./signerRegistry.js";
import {
  AuthoritySigner,
  AuthoritySignerBackend,
  HsmAuthoritySigner,
  KmsAuthoritySigner,
  LocalAuthoritySigner,
} from "./authoritySigner.js";

export interface ReplaySigner {
  authorityId: string;
  signerId: string;
  privateKey: string;
  publicKey: string;
}

function isAuthoritySigner(signer: ReplaySigner | AuthoritySigner): signer is AuthoritySigner {
  return typeof (signer as AuthoritySigner).sign === "function";
}

export function buildCanonicalReplayArtifactRoot(input: {
  replayHash: string;
  runtimeHash: string;
  deploymentHash: string;
  buildHash: string;
  governanceHash: string;
  manifestHash: string;
  attestationHash: string;
  decisionId: string;
  lineageId: string;
  timestamp: string;
}): ReplayArtifactRoot {
  return {
    replayHash: input.replayHash,
    runtimeHash: input.runtimeHash,
    deploymentHash: input.deploymentHash,
    buildHash: input.buildHash,
    governanceHash: input.governanceHash,
    manifestHash: input.manifestHash,
    attestationHash: input.attestationHash,
    decisionId: input.decisionId,
    lineageId: input.lineageId,
    timestamp: input.timestamp,
  };
}

export function signReplayArtifact(payload: ReplayArtifactRoot, signer: ReplaySigner | AuthoritySigner): SignatureRecord {
  const artifactHash = computeReplayArtifactHash(payload);
  const message = Buffer.from(artifactHash, "utf8");

  if (isAuthoritySigner(signer)) {
    return {
      signatureId: randomUUID(),
      signature: signer.sign(message),
      algorithm: DEFAULT_SIGNING_ALGORITHM,
      signedAt: new Date().toISOString(),
      authorityId: signer.getAuthorityId(),
      signerId: signer.getSignerId(),
      artifactHash,
      publicKey: signer.getPublicKey(),
    };
  }

  const privateKey = createPrivateKey(signer.privateKey);
  const signature = signBuffer(null, message, privateKey).toString("base64");

  return {
    signatureId: randomUUID(),
    signature,
    algorithm: DEFAULT_SIGNING_ALGORITHM,
    signedAt: new Date().toISOString(),
    authorityId: signer.authorityId,
    signerId: signer.signerId,
    artifactHash,
    publicKey: signer.publicKey,
  };
}

export function generateEd25519KeyPair(): { privateKey: string; publicKey: string } {
  const keyPair = generateKeyPairSync("ed25519");
  const privateKey = keyPair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const publicKey = keyPair.publicKey.export({ type: "spki", format: "pem" }).toString();
  return { privateKey, publicKey };
}

let defaultSigner: ReplaySigner | null = null;
let defaultAuthoritySigner: AuthoritySigner | null = null;
export const DEFAULT_LOCAL_SIGNER_PRIVATE_KEY_PATH = join(
  process.cwd(),
  "authority",
  "signing",
  "authoritySigner.private.pem",
);

function getSignerBackend(): AuthoritySignerBackend {
  const raw = (process.env.AVA007_SIGNER_BACKEND ?? "local").toLowerCase();
  if (raw === "local" || raw === "kms" || raw === "hsm") {
    return raw;
  }

  throw new Error(`Unsupported AVA007_SIGNER_BACKEND '${raw}'. Expected local, kms, or hsm.`);
}

export function getDefaultAuthoritySigner(): AuthoritySigner {
  if (defaultAuthoritySigner) {
    return defaultAuthoritySigner;
  }

  const registry = loadAuthoritySignerRegistry();
  const authorityId = process.env.AVA007_AUTHORITY_ID ?? registry.activeAuthority.authorityId;
  const signerId = process.env.AVA007_SIGNER_ID ?? authorityId;
  const backend = getSignerBackend();

  if (backend === "local") {
    const privateKeyFromEnv = process.env.AVA007_SIGNER_PRIVATE_KEY_PEM;
    const privateKeyPath =
      process.env.AVA007_SIGNER_PRIVATE_KEY_PATH && process.env.AVA007_SIGNER_PRIVATE_KEY_PATH.length > 0
        ? process.env.AVA007_SIGNER_PRIVATE_KEY_PATH
        : DEFAULT_LOCAL_SIGNER_PRIVATE_KEY_PATH;
    const privateKeyFromFile = existsSync(privateKeyPath) ? readFileSync(privateKeyPath, "utf8") : undefined;
    const privateKeyPem = privateKeyFromEnv ?? privateKeyFromFile;

    if (privateKeyPem) {
      const derivedPublicKey = createPublicKey(createPrivateKey(privateKeyPem))
        .export({ type: "spki", format: "pem" })
        .toString();

      if (registry.activeAuthority.publicKey.length > 0 && registry.activeAuthority.publicKey !== derivedPublicKey) {
        throw new Error(
          [
            `active authority '${authorityId}' public key does not match local signer private key`,
            `expected key from authority registry and signer key at '${privateKeyPath}' to match`,
            "run 'ava007 trust bootstrap' or set AVA007_SIGNER_PRIVATE_KEY_PEM",
          ].join("; "),
        );
      }

      defaultAuthoritySigner = new LocalAuthoritySigner({
        authorityId,
        signerId,
        privateKeyPem,
        publicKeyPem: derivedPublicKey,
      });

      return defaultAuthoritySigner;
    }

    if (registry.activeAuthority.publicKey.length > 0) {
      throw new Error(
        [
          `active authority '${authorityId}' has a registered public key but no private signing key was provided`,
          `set AVA007_SIGNER_PRIVATE_KEY_PEM or place a PEM key at '${privateKeyPath}'`,
          "run 'ava007 trust bootstrap' to initialize local trust root keys",
        ].join("; "),
      );
    }

    const generated = generateEd25519KeyPair();
    defaultAuthoritySigner = new LocalAuthoritySigner({
      authorityId,
      signerId,
      privateKeyPem: generated.privateKey,
      publicKeyPem: generated.publicKey,
    });

    return defaultAuthoritySigner;
  }

  const publicKeyPem = process.env.AVA007_SIGNER_PUBLIC_KEY_PEM;
  if (!publicKeyPem || publicKeyPem.length === 0) {
    throw new Error(`AVA007_SIGNER_PUBLIC_KEY_PEM is required for ${backend.toUpperCase()} signer backend`);
  }

  const keyRefEnv = backend === "kms" ? process.env.AVA007_KMS_KEY_REF : process.env.AVA007_HSM_KEY_REF;
  if (!keyRefEnv || keyRefEnv.length === 0) {
    throw new Error(`${backend === "kms" ? "AVA007_KMS_KEY_REF" : "AVA007_HSM_KEY_REF"} is required for ${backend.toUpperCase()} signer backend`);
  }

  defaultAuthoritySigner =
    backend === "kms"
      ? new KmsAuthoritySigner({ authorityId, signerId, publicKeyPem, keyRef: keyRefEnv })
      : new HsmAuthoritySigner({ authorityId, signerId, publicKeyPem, keyRef: keyRefEnv });

  return defaultAuthoritySigner;
}

export function getDefaultReplaySigner(): ReplaySigner {
  if (defaultSigner) {
    return defaultSigner;
  }

  const authoritySigner = getDefaultAuthoritySigner();
  if (!(authoritySigner instanceof LocalAuthoritySigner)) {
    throw new Error(
      "getDefaultReplaySigner requires local signing backend. Use getDefaultAuthoritySigner for kms/hsm backends.",
    );
  }

  defaultSigner = {
    authorityId: authoritySigner.getAuthorityId(),
    signerId: authoritySigner.getSignerId(),
    privateKey: authoritySigner.getPrivateKey(),
    publicKey: authoritySigner.getPublicKey(),
  };

  return defaultSigner;
}
