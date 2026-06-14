import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import { sealReplayRecord } from "../../authority/persistence/replayProof.js";
import { computeRuntimeHash } from "../../authority/runtime/runtimeLoader.js";
import { CANONICAL_AUTHORITY_ORDER } from "../../authority/replay/replayContract.js";
import { ReplayRecord, ReplayRecordInput } from "../../authority/service/replayRecord.js";
import { verifyReplay } from "../../authority/verification/verifyReplay.js";
import { ReconstructionBenchmarkReport, ReconstructionBenchmarkScaleResult } from "./types.js";

interface TransitionEvent {
  eventId: string;
  atomRef: string;
  delta: number;
  summary: string;
  replayRecord: ReplayRecord;
}

interface SnapshotState {
  counter: number;
  atomCounts: Record<string, number>;
}

const ATOMS = ["ATTACH_PANEL", "INSERT_DOWEL", "TIGHTEN_BOLT", "ALIGN_BRACKET"];

export interface ReconstructionBenchmarkOptions {
  scales?: number[];
  checkpointInterval?: number;
}

export async function runReconstructionBenchmark(
  options: ReconstructionBenchmarkOptions = {},
): Promise<ReconstructionBenchmarkReport> {
  const scales = options.scales && options.scales.length > 0 ? options.scales : [10, 100, 1_000, 10_000, 100_000];
  const checkpointInterval = options.checkpointInterval && options.checkpointInterval > 0
    ? Math.floor(options.checkpointInterval)
    : 50;
  const results: ReconstructionBenchmarkScaleResult[] = [];

  for (const eventCount of scales) {
    const snapshot: SnapshotState = {
      counter: 0,
      atomCounts: Object.fromEntries(ATOMS.map((atom) => [atom, 0])),
    };

    const events = buildEvents(eventCount);

    const verifyAuthorityStart = performance.now();
    let authorityVerified = 0;
    for (const event of events) {
      const verification = verifyReplay(event.replayRecord);
      if (verification.authorityValid && verification.keyRegistered && verification.signatureValid) {
        authorityVerified += 1;
      }
    }
    const verifyAuthorityMs = performance.now() - verifyAuthorityStart;

    const checkpointVerificationStart = performance.now();
    const checkpointVerification = verifyWithCheckpoints(events, checkpointInterval);
    const verifyCheckpointMs = performance.now() - checkpointVerificationStart;

    const merkleVerificationStart = performance.now();
    const merkleVerification = verifyWithMerkleOnly(events, checkpointInterval);
    const verifyMerkleMs = performance.now() - merkleVerificationStart;

    const reconstructStart = performance.now();
    const reconstructed = reconstructState(snapshot, events);
    const reconstructMs = performance.now() - reconstructStart;

    const explainStart = performance.now();
    const explanation = explainLineage(events, reconstructed);
    const explainLineageMs = performance.now() - explainStart;

    const baselineLookupStart = performance.now();
    runFaissLikeLookup(events, "panel alignment bolt");
    const faissLikeLookupMs = performance.now() - baselineLookupStart;

    const textLookupStart = performance.now();
    runOpenSearchLikeLookup(events, "ALIGN_BRACKET");
    const openSearchLikeLookupMs = performance.now() - textLookupStart;

    const transitionBytes = byteSize(events.map((event) => ({
      eventId: event.eventId,
      atomRef: event.atomRef,
      delta: event.delta,
      summary: event.summary,
    })));

    const signedTransitionBytes = byteSize(events.map((event) => event.replayRecord));
    const stateOnlyBytes = byteSize(buildStateOnlySeries(events, snapshot));

    const reduction = stateOnlyBytes === 0 ? 0 : ((stateOnlyBytes - signedTransitionBytes) / stateOnlyBytes) * 100;

    results.push({
      events: eventCount,
      reconstructMs: round(reconstructMs),
      verifyAuthorityMs: round(verifyAuthorityMs),
      verifyCheckpointMs: round(verifyCheckpointMs),
      verifyMerkleMs: round(verifyMerkleMs),
      explainLineageMs: round(explainLineageMs),
      totalMs: round(reconstructMs + verifyAuthorityMs + explainLineageMs),
      totalCheckpointMs: round(reconstructMs + verifyCheckpointMs + explainLineageMs),
      totalMerkleMs: round(reconstructMs + verifyMerkleMs + explainLineageMs),
      checkpointInterval,
      authorityIntegrityPercent: round((authorityVerified / eventCount) * 100),
      checkpointIntegrityPercent: round((checkpointVerification.verifiedSegments / checkpointVerification.totalSegments) * 100),
      merkleIntegrityPercent: round((merkleVerification.verifiedSegments / merkleVerification.totalSegments) * 100),
      explainabilityScore: round(explanation.coverageScore),
      transitionBytes,
      signedTransitionBytes,
      stateOnlyBytes,
      storageReductionPercent: round(reduction),
      faissLikeLookupMs: round(faissLikeLookupMs),
      openSearchLikeLookupMs: round(openSearchLikeLookupMs),
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    scales: results,
    notes: [
      "faissLikeLookupMs is a deterministic in-process cosine similarity baseline, not a FAISS runtime.",
      "openSearchLikeLookupMs is a deterministic in-process keyword scan baseline, not an OpenSearch runtime.",
      "Authority verification uses strict replay verification against local authority registry.",
      "verifyCheckpointMs verifies one signed checkpoint per segment plus segment Merkle root recomputation.",
      "verifyMerkleMs verifies only segment Merkle root recomputation (archive-mode integrity check).",
    ],
  };
}

function verifyWithCheckpoints(
  events: TransitionEvent[],
  checkpointInterval: number,
): { verifiedSegments: number; totalSegments: number } {
  const roots = computeSegmentRoots(events, checkpointInterval);
  let verifiedSegments = 0;

  for (const segment of roots) {
    const checkpointEvent = events[segment.endIndex];
    const checkpointVerification = verifyReplay(checkpointEvent.replayRecord);
    if (!(checkpointVerification.authorityValid && checkpointVerification.keyRegistered && checkpointVerification.signatureValid)) {
      continue;
    }

    const segmentHashes = events.slice(segment.startIndex, segment.endIndex + 1).map((entry) => entry.replayRecord.replayHash);
    const recomputedRoot = computeMerkleRoot(segmentHashes);
    if (recomputedRoot === segment.root) {
      verifiedSegments += 1;
    }
  }

  return {
    verifiedSegments,
    totalSegments: roots.length,
  };
}

function verifyWithMerkleOnly(
  events: TransitionEvent[],
  checkpointInterval: number,
): { verifiedSegments: number; totalSegments: number } {
  const roots = computeSegmentRoots(events, checkpointInterval);
  let verifiedSegments = 0;

  for (const segment of roots) {
    const segmentHashes = events.slice(segment.startIndex, segment.endIndex + 1).map((entry) => entry.replayRecord.replayHash);
    const recomputedRoot = computeMerkleRoot(segmentHashes);
    if (recomputedRoot === segment.root) {
      verifiedSegments += 1;
    }
  }

  return {
    verifiedSegments,
    totalSegments: roots.length,
  };
}

function computeSegmentRoots(
  events: TransitionEvent[],
  checkpointInterval: number,
): Array<{ startIndex: number; endIndex: number; root: string }> {
  const roots: Array<{ startIndex: number; endIndex: number; root: string }> = [];

  for (let start = 0; start < events.length; start += checkpointInterval) {
    const end = Math.min(events.length, start + checkpointInterval) - 1;
    const segmentHashes = events.slice(start, end + 1).map((entry) => entry.replayRecord.replayHash);
    roots.push({
      startIndex: start,
      endIndex: end,
      root: computeMerkleRoot(segmentHashes),
    });
  }

  return roots;
}

function computeMerkleRoot(leaves: string[]): string {
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

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function buildEvents(count: number): TransitionEvent[] {
  const runtimeHost = "benchmark-host";
  const runtimeStartedAt = "2026-06-03T00:00:00.000Z";
  const runtimeProcessId = 8100;
  const deploymentHash = "benchmark-deployment-hash";
  const runtimeHash = computeRuntimeHash(deploymentHash, runtimeProcessId, runtimeHost, runtimeStartedAt);

  const events: TransitionEvent[] = [];
  for (let index = 0; index < count; index += 1) {
    const atomRef = ATOMS[index % ATOMS.length];
    const delta = (index % 3) + 1;
    const eventId = `event-${index + 1}`;
    const timestamp = new Date(Date.UTC(2026, 5, 3, 0, 0, index % 60, index % 1000)).toISOString();

    const replayInput: ReplayRecordInput = {
      replayId: `replay-${eventId}`,
      decisionId: `decision-${eventId}`,
      lineageId: `lineage-${eventId}`,
      governanceVersion: "1.5",
      governanceHash: "774960f6ee7f498c08ca834b581c7f95004fc5672da2d94c30dca8b6480e7bcb",
      manifestHash: "6173b2079a7486ec093ea44a4b84719a2ea8ac78b67e196d69c8be2645ecc526",
      attestationHash: "13f0c11b28b13351055a70ff8fdbc02dbdc181e9489ae024bcee3baf31c16b5b",
      runtimeVersion: "0.1.0",
      runtimeHash,
      runtimeStartedAt,
      runtimeHost,
      runtimeProcessId,
      runtimeNodeVersion: process.version,
      runtimePlatform: process.platform,
      gitCommit: "5e300b0d9aa609a973e25420a884e30af88b070a",
      buildHash: "5ce15fd82449ffaa115cd4a5dc915846689a5fa1ca2bebe88d5c7bd07d56e148",
      buildTimestamp: "2026-06-03T00:00:00.000Z",
      worktreeDirty: true,
      deploymentVersion: "1.0.0",
      deploymentHash,
      releaseId: "benchmark-release",
      environment: "benchmark",
      status: "VERIFIED",
      failureReasons: [],
      authorityOrder: [...CANONICAL_AUTHORITY_ORDER],
      timestamp,
      startedAt: timestamp,
      completedAt: timestamp,
    };

    events.push({
      eventId,
      atomRef,
      delta,
      summary: `${atomRef} +${delta}`,
      replayRecord: sealReplayRecord(replayInput),
    });
  }

  return events;
}

function reconstructState(snapshot: SnapshotState, events: TransitionEvent[]): SnapshotState {
  const next: SnapshotState = {
    counter: snapshot.counter,
    atomCounts: { ...snapshot.atomCounts },
  };

  for (const event of events) {
    next.counter += event.delta;
    next.atomCounts[event.atomRef] = (next.atomCounts[event.atomRef] ?? 0) + 1;
  }

  return next;
}

function explainLineage(events: TransitionEvent[], reconstructed: SnapshotState): { summary: string; coverageScore: number } {
  const uniqueAtoms = new Set(events.map((event) => event.atomRef));
  const validEvents = events.filter((event) => event.replayRecord.signature.signatureId.length > 0).length;
  const atomCoverage = uniqueAtoms.size / ATOMS.length;
  const signatureCoverage = events.length === 0 ? 0 : validEvents / events.length;
  const coverageScore = Math.min(100, (atomCoverage * 0.4 + signatureCoverage * 0.6) * 100);

  return {
    summary: `counter=${reconstructed.counter}; atoms=${Array.from(uniqueAtoms).join(",")}`,
    coverageScore,
  };
}

function runFaissLikeLookup(events: TransitionEvent[], query: string): number {
  const queryVector = toVector(query);
  let best = -1;

  for (const event of events) {
    const score = cosine(queryVector, toVector(event.summary));
    if (score > best) {
      best = score;
    }
  }

  return best;
}

function runOpenSearchLikeLookup(events: TransitionEvent[], keyword: string): number {
  const normalized = keyword.toLowerCase();
  let matches = 0;
  for (const event of events) {
    if (event.summary.toLowerCase().includes(normalized)) {
      matches += 1;
    }
  }

  return matches;
}

function toVector(value: string): number[] {
  const vector = new Array(8).fill(0);
  for (let index = 0; index < value.length; index += 1) {
    vector[index % vector.length] += value.charCodeAt(index);
  }

  return vector;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let aNorm = 0;
  let bNorm = 0;

  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    aNorm += a[index] * a[index];
    bNorm += b[index] * b[index];
  }

  if (aNorm === 0 || bNorm === 0) {
    return 0;
  }

  return dot / (Math.sqrt(aNorm) * Math.sqrt(bNorm));
}

function buildStateOnlySeries(
  events: TransitionEvent[],
  snapshot: SnapshotState,
): Array<{
  checkpoint: number;
  fullState: SnapshotState;
  replayRecord: ReplayRecord;
}> {
  const series: Array<{
    checkpoint: number;
    fullState: SnapshotState;
    replayRecord: ReplayRecord;
  }> = [];

  const current: SnapshotState = {
    counter: snapshot.counter,
    atomCounts: { ...snapshot.atomCounts },
  };

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    current.counter += event.delta;
    current.atomCounts[event.atomRef] = (current.atomCounts[event.atomRef] ?? 0) + 1;

    series.push({
      checkpoint: index + 1,
      fullState: {
        counter: current.counter,
        atomCounts: { ...current.atomCounts },
      },
      replayRecord: event.replayRecord,
    });
  }

  return series;
}

function byteSize(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function round(value: number): number {
  return Number(value.toFixed(3));
}
