import { SigningAlgorithm } from "./signingAlgorithm.js";

export interface ReplayArtifactRoot {
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
}

export interface SignatureRecord {
  signatureId: string;
  signature: string;
  algorithm: SigningAlgorithm;
  signedAt: string;
  authorityId?: string;
  signerId: string;
  artifactHash: string;
  publicKey?: string;
}
