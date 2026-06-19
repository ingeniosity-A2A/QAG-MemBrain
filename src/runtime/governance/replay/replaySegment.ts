import { createHash, createPublicKey, verify as verifyBuffer } from "node:crypto";
import { readFile } from "node:fs/promises";
import { ReplayRecord } from "../service/replayRecord.js";
import { SigningAlgorithm } from "../signing/signingAlgorithm.js";
import { loadAuthoritySignerRegistry } from "../signing/signerRegistry.js";
import { getDefaultAuthoritySigner } from "../signing/signer.js";

interface ReplaySegmentSigner {
  getAuthorityId(): string;
  getSignerId(): string;
  getPublicKey(): string | undefined;
  sign(data: Uint8Array): string;
}

export interface ReplaySegmentSignature {
  signature: string;
  algorithm: SigningAlgorithm;
  signedAt: string;
  authorityId: string;
  signerId: string;
  artifactHash: string;
  publicKey?: string;
}

export interface ReplaySegment {
  segmentId: string;
  startEvent: string;
  endEvent: string;
  checkpointHash: string;
  merkleRoot: string;
  signature: ReplaySegmentSignature;
  authorityId: string;
  verificationMode: "checkpoint" | "merkle";
  checkpointRecordIndex: number;
}

export function computeMerkleRoot(leaves: string[]): string {
  if (leaves.length === 0) {
    return sha256Hex("empty");
  }

  let level = leaves.map((leaf) => sha256Hex(leaf));
  while (level.length > 1) {
    const next: string[] = [];
    for (let index = 0; index < level.length; index += 2) {
      const left = level[index];
      const right = index + 1 < level.length ? level[index + 1] : left;
      next.push(sha256Hex(`${left}${right}`));
    }
    level = next;
  }

  return level[0];
}

export function buildReplaySegments(
  records: ReplayRecord[],
  checkpointInterval: number,
  signerInput?: ReplaySegmentSigner,
): ReplaySegment[] {
  if (checkpointInterval <= 0) {
    throw new Error("checkpointInterval must be > 0");
  }

  const signer = signerInput ?? getDefaultAuthoritySigner();
  const segments: ReplaySegment[] = [];

  for (let start = 0; start < records.length; start += checkpointInterval) {
    const end = Math.min(records.length - 1, start + checkpointInterval - 1);
    const segmentRecords = records.slice(start, end + 1);
    const merkleRoot = computeMerkleRoot(segmentRecords.map((record) => record.replayHash));
    const checkpointRecord = segmentRecords[segmentRecords.length - 1];
    const checkpointHash = checkpointRecord.replayHash;
    const segmentId = `segment-${start + 1}-${end + 1}`;
    const artifactHash = computeSegmentArtifactHash({
      segmentId,
      startEvent: checkpointRecordIndexToEventRef(segmentRecords[0], start),
      endEvent: checkpointRecordIndexToEventRef(checkpointRecord, end),
      checkpointHash,
      merkleRoot,
      checkpointRecordIndex: end,
    });

    segments.push({
      segmentId,
      startEvent: checkpointRecordIndexToEventRef(segmentRecords[0], start),
      endEvent: checkpointRecordIndexToEventRef(checkpointRecord, end),
      checkpointHash,
      merkleRoot,
      authorityId: signer.getAuthorityId(),
      verificationMode: "checkpoint",
      checkpointRecordIndex: end,
      signature: {
        signature: signer.sign(Buffer.from(artifactHash, "utf8")),
        algorithm: "ed25519",
        signedAt: new Date().toISOString(),
        authorityId: signer.getAuthorityId(),
        signerId: signer.getSignerId(),
        artifactHash,
        publicKey: signer.getPublicKey(),
      },
    });
  }

  return segments;
}

export function verifyReplaySegmentSignature(segment: ReplaySegment): boolean {
  if (segment.signature.algorithm !== "ed25519") {
    return false;
  }

  const expectedHash = computeSegmentArtifactHash({
    segmentId: segment.segmentId,
    startEvent: segment.startEvent,
    endEvent: segment.endEvent,
    checkpointHash: segment.checkpointHash,
    merkleRoot: segment.merkleRoot,
    checkpointRecordIndex: segment.checkpointRecordIndex,
  });

  if (expectedHash !== segment.signature.artifactHash) {
    return false;
  }

  const registry = loadAuthoritySignerRegistry();
  const authority = registry.resolveAuthority(segment.authorityId);
  if (!authority) {
    return false;
  }

  if (!registry.isAuthorityValidAt(segment.authorityId, segment.signature.signedAt)) {
    return false;
  }

  const publicKeyPem = registry.resolvePublicKey(segment.authorityId);
  if (!publicKeyPem) {
    return false;
  }

  try {
    const publicKey = createPublicKey(publicKeyPem);
    return verifyBuffer(
      null,
      Buffer.from(segment.signature.artifactHash, "utf8"),
      publicKey,
      Buffer.from(segment.signature.signature, "base64"),
    );
  } catch {
    return false;
  }
}

export async function loadReplaySegments(path: string): Promise<ReplaySegment[]> {
  const raw = await readFile(path, "utf8");
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return lines.map((line) => JSON.parse(line) as ReplaySegment);
}

function computeSegmentArtifactHash(input: {
  segmentId: string;
  startEvent: string;
  endEvent: string;
  checkpointHash: string;
  merkleRoot: string;
  checkpointRecordIndex: number;
}): string {
  return sha256Hex(
    JSON.stringify(
      {
        segmentId: input.segmentId,
        startEvent: input.startEvent,
        endEvent: input.endEvent,
        checkpointHash: input.checkpointHash,
        merkleRoot: input.merkleRoot,
        checkpointRecordIndex: input.checkpointRecordIndex,
      },
      null,
      0,
    ),
  );
}

function checkpointRecordIndexToEventRef(record: ReplayRecord, index: number): string {
  return `${record.replayId}@${index + 1}`;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
