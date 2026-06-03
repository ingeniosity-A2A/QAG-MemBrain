import { createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID, sign as signBuffer } from "node:crypto";
import { DEFAULT_SIGNING_ALGORITHM } from "./signingAlgorithm.js";
import { ReplayArtifactRoot, SignatureRecord } from "./signatureRecord.js";
import { computeReplayArtifactHash } from "./signatureHash.js";
import { loadAuthoritySignerRegistry } from "./signerRegistry.js";

export interface ReplaySigner {
  authorityId: string;
  signerId: string;
  privateKey: string;
  publicKey: string;
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

export function signReplayArtifact(payload: ReplayArtifactRoot, signer: ReplaySigner): SignatureRecord {
  const artifactHash = computeReplayArtifactHash(payload);
  const privateKey = createPrivateKey(signer.privateKey);
  const signature = signBuffer(null, Buffer.from(artifactHash, "utf8"), privateKey).toString("base64");

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

export function getDefaultReplaySigner(): ReplaySigner {
  if (defaultSigner) {
    return defaultSigner;
  }

  const registry = loadAuthoritySignerRegistry();
  const authorityId = process.env.AVA007_AUTHORITY_ID ?? registry.activeAuthority.authorityId;
  const signerId = process.env.AVA007_SIGNER_ID ?? authorityId;
  const privateKeyFromEnv = process.env.AVA007_SIGNER_PRIVATE_KEY_PEM;

  if (privateKeyFromEnv) {
    const privateKey = createPrivateKey(privateKeyFromEnv);
    const publicKey = createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString();

    defaultSigner = {
      authorityId,
      signerId,
      privateKey: privateKeyFromEnv,
      publicKey,
    };

    return defaultSigner;
  }

  const generated = generateEd25519KeyPair();
  defaultSigner = {
    authorityId,
    signerId,
    privateKey: generated.privateKey,
    publicKey: generated.publicKey,
  };

  return defaultSigner;
}
