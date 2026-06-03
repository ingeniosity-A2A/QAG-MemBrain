import { ReplayRecord, ReplayRecordInput } from "../service/replayRecord.js";
import { computeReplayHash } from "./replayHash.js";
import { assertSignatureRecordShape } from "../signing/signatureSchemas.js";
import {
  buildCanonicalReplayArtifactRoot,
  getDefaultReplaySigner,
  signReplayArtifact,
} from "../signing/signer.js";
import { verifyReplayArtifactSignature } from "../signing/verifier.js";

export function sealReplayRecord(record: ReplayRecordInput): ReplayRecord {
  const replayHash = computeReplayHash(record);
  const replayArtifactRoot = buildCanonicalReplayArtifactRoot({
    replayHash,
    runtimeHash: record.runtimeHash,
    deploymentHash: record.deploymentHash,
    buildHash: record.buildHash,
    governanceHash: record.governanceHash,
    manifestHash: record.manifestHash,
    attestationHash: record.attestationHash,
    decisionId: record.decisionId,
    lineageId: record.lineageId,
    timestamp: record.timestamp,
  });

  return {
    ...record,
    replayHash,
    proof: {
      algorithm: "sha256",
    },
    signature: signReplayArtifact(replayArtifactRoot, getDefaultReplaySigner()),
  };
}

export function verifyReplayRecord(record: ReplayRecord): boolean {
  if (record.proof.algorithm !== "sha256") {
    return false;
  }

  try {
    assertSignatureRecordShape(record.signature);
  } catch {
    return false;
  }

  const { replayHash, proof: _proof, signature, ...payload } = record;

  if (replayHash !== computeReplayHash(payload)) {
    return false;
  }

  const replayArtifactRoot = buildCanonicalReplayArtifactRoot({
    replayHash,
    runtimeHash: payload.runtimeHash,
    deploymentHash: payload.deploymentHash,
    buildHash: payload.buildHash,
    governanceHash: payload.governanceHash,
    manifestHash: payload.manifestHash,
    attestationHash: payload.attestationHash,
    decisionId: payload.decisionId,
    lineageId: payload.lineageId,
    timestamp: payload.timestamp,
  });

  return verifyReplayArtifactSignature(replayArtifactRoot, signature);
}