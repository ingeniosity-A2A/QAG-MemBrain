#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { dedupReplayRecords } from "../authority/replay/replayDedup.js";
import { normalizeReplayLedger } from "../authority/replay/replayNormalizer.js";
import { buildReplaySegments } from "../authority/replay/replaySegment.js";
import { bootstrapAuthorityTrustRoot } from "../authority/signing/trustBootstrap.js";
import { verifyArtifact, VerificationMode } from "../authority/verification/verifyArtifact.js";
import { renderVerificationReport } from "../authority/verification/verificationReport.js";
import { ReplayRecord } from "../authority/service/replayRecord.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === "verify") {
    await runVerify(args.slice(1));
    return;
  }

  if (command === "trust" && args[1] === "bootstrap") {
    await runTrustBootstrap(args.slice(2));
    return;
  }

  if (command === "replay" && args[1] === "normalize") {
    await runReplayNormalize(args.slice(2));
    return;
  }

  if (command === "replay" && args[1] === "segmentize") {
    await runReplaySegmentize(args.slice(2));
    return;
  }

  if (command === "replay" && args[1] === "dedup") {
    await runReplayDedup(args.slice(2));
    return;
  }

  printUsage();
  process.exitCode = 1;
}

async function runVerify(args: string[]): Promise<void> {
  const artifactPathArg = args[0];
  if (!artifactPathArg) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const artifactPath = resolve(process.cwd(), artifactPathArg);
  const mode = parseVerificationMode(args);
  const checkpointInterval = parseNumericFlag(args, "--checkpoint-interval");
  const segmentsPath = parseFlagValue(args, "--segments");
  const jsonOnly = args.includes("--json");
  const jsonOutIndex = args.indexOf("--json-out");
  const jsonOutPath = jsonOutIndex >= 0 ? args[jsonOutIndex + 1] : undefined;

  try {
    const report = await verifyArtifact(artifactPath, {}, {
      mode,
      checkpointInterval,
      segmentPath: segmentsPath ? resolve(process.cwd(), segmentsPath) : undefined,
    });

    if (!jsonOnly) {
      process.stdout.write(renderVerificationReport(report));
      process.stdout.write("\nReport JSON\n");
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    }

    if (jsonOutPath) {
      await writeFile(resolve(process.cwd(), jsonOutPath), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    }

    process.exitCode = report.trusted ? 0 : 2;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Verification failed: ${message}\n`);
    process.exitCode = 1;
  }
}

function parseVerificationMode(args: string[]): VerificationMode {
  const raw = parseFlagValue(args, "--mode") ?? "checkpoint";
  if (raw === "full" || raw === "checkpoint" || raw === "merkle") {
    return raw;
  }

  throw new Error(`invalid --mode '${raw}'. Expected full, checkpoint, or merkle.`);
}

function parseNumericFlag(args: string[], flag: string): number | undefined {
  const raw = parseFlagValue(args, flag);
  if (!raw) {
    return undefined;
  }

  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${flag} requires a positive number`);
  }

  return Math.floor(value);
}

async function runTrustBootstrap(args: string[]): Promise<void> {
  const entries = parseRepeatedFlag(args, "--entry");
  if (entries.length === 0) {
    throw new Error("trust bootstrap requires at least one --entry <authorityId,activatedAt[,expiresAt]> argument");
  }

  const privateOut = parseFlagValue(args, "--private-out");
  const privateBundleOut = parseFlagValue(args, "--private-bundle-out");
  const result = bootstrapAuthorityTrustRoot(
    entries.map((entry, index) => {
      const [authorityId, activatedAt, expiresAt] = entry.split(",");
      if (!authorityId || !activatedAt) {
        throw new Error(`invalid --entry at index ${index}: expected authorityId,activatedAt[,expiresAt]`);
      }

      return {
        authorityId,
        activatedAt,
        expiresAt,
      };
    }),
    privateOut ? { privateKeyPath: resolve(process.cwd(), privateOut) } : undefined,
  );

  process.stdout.write("Authority trust root bootstrapped\n");
  process.stdout.write(`Active authority: ${result.manifest.authorityId}\n`);
  process.stdout.write(`Trusted authorities: ${result.trustedAuthorities.authorities.length}\n`);
  process.stdout.write(`Active private key path: ${result.activePrivateKeyPath}\n`);
  process.stdout.write("Generated public keys\n");
  for (const entry of result.generated) {
    process.stdout.write(`- ${entry.descriptor.authorityId} (${entry.descriptor.status})\n`);
  }

  if (privateBundleOut) {
    const privateBundlePath = resolve(process.cwd(), privateBundleOut);
    await mkdir(dirname(privateBundlePath), { recursive: true });
    await writeFile(
      privateBundlePath,
      `${JSON.stringify(
        result.generated.map((entry) => ({
          authorityId: entry.descriptor.authorityId,
          privateKeyPem: entry.privateKeyPem,
        })),
        null,
        2,
      )}\n`,
      "utf8",
    );
    process.stdout.write(`Private key bundle path: ${privateBundlePath}\n`);
  }
}

async function runReplayNormalize(args: string[]): Promise<void> {
  const inputArg = args[0];
  if (!inputArg) {
    throw new Error("replay normalize requires <input-jsonl>");
  }

  const outputArg = parseFlagValue(args, "--out") ?? "authority/replay/replay.normalized.jsonl";
  const resign = args.includes("--resign");
  const result = await normalizeReplayLedger(resolve(process.cwd(), inputArg), resolve(process.cwd(), outputArg), {
    resign,
  });

  process.stdout.write("Replay normalization completed\n");
  process.stdout.write(`Input rows: ${result.totalRows}\n`);
  process.stdout.write(`Kept rows: ${result.keptRows}\n`);
  process.stdout.write(`Dropped rows: ${result.droppedRows}\n`);
  process.stdout.write(`Resigned rows: ${resign ? "yes" : "no"}\n`);

  if (result.issues.length > 0) {
    process.stdout.write("Dropped row reasons\n");
    for (const issue of result.issues) {
      process.stdout.write(`- line ${issue.line}: ${issue.reason}\n`);
    }
  }
}

async function runReplaySegmentize(args: string[]): Promise<void> {
  const inputArg = args[0];
  if (!inputArg) {
    throw new Error("replay segmentize requires <input-jsonl>");
  }

  const outputArg = parseFlagValue(args, "--out") ?? "authority/replay/replay.segments.jsonl";
  const checkpointInterval = parseNumericFlag(args, "--checkpoint-interval") ?? 5000;

  const records = await loadReplayRecords(resolve(process.cwd(), inputArg));
  const segments = buildReplaySegments(records, checkpointInterval);
  const outPath = resolve(process.cwd(), outputArg);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${segments.map((segment) => JSON.stringify(segment)).join("\n")}\n`, "utf8");

  process.stdout.write("Replay segmentization completed\n");
  process.stdout.write(`Input records: ${records.length}\n`);
  process.stdout.write(`Segments: ${segments.length}\n`);
  process.stdout.write(`Checkpoint interval: ${checkpointInterval}\n`);
  process.stdout.write(`Output: ${outPath}\n`);
}

async function runReplayDedup(args: string[]): Promise<void> {
  const inputArg = args[0];
  if (!inputArg) {
    throw new Error("replay dedup requires <input-jsonl>");
  }

  const outputArg = parseFlagValue(args, "--out") ?? "authority/replay/replay.dedup.jsonl";
  const checkpointInterval = parseNumericFlag(args, "--checkpoint-interval") ?? 5000;

  const records = await loadReplayRecords(resolve(process.cwd(), inputArg));
  const dedup = dedupReplayRecords(records, checkpointInterval);
  const outPath = resolve(process.cwd(), outputArg);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${dedup.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");

  process.stdout.write("Replay dedup completed\n");
  process.stdout.write(`Input records: ${records.length}\n`);
  process.stdout.write(`Output entries: ${dedup.length}\n`);
  process.stdout.write(`Checkpoint interval: ${checkpointInterval}\n`);
  process.stdout.write(`Output: ${outPath}\n`);
}

async function loadReplayRecords(path: string): Promise<ReplayRecord[]> {
  const raw = await readFile(path, "utf8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as ReplayRecord);
}

function parseRepeatedFlag(args: string[], flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag) {
      const value = args[index + 1];
      if (!value) {
        throw new Error(`${flag} requires a value`);
      }
      values.push(value);
      index += 1;
    }
  }
  return values;
}

function parseFlagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index < 0) {
    return undefined;
  }

  const value = args[index + 1];
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }

  return value;
}

function printUsage(): void {
  process.stderr.write(
    [
      "Usage:",
      "  ava007 verify <artifact-path> [--mode <full|checkpoint|merkle>] [--segments <path>] [--checkpoint-interval <n>] [--json] [--json-out <path>]",
      "  ava007 trust bootstrap --entry <authorityId,activatedAt[,expiresAt]> [--entry ...] [--private-out <path>] [--private-bundle-out <path>]",
      "  ava007 replay normalize <input-jsonl> [--out <path>] [--resign]",
      "  ava007 replay segmentize <input-jsonl> [--out <path>] [--checkpoint-interval <n>]",
      "  ava007 replay dedup <input-jsonl> [--out <path>] [--checkpoint-interval <n>]",
      "",
      "Examples:",
      "  ava007 verify authority/replay/replay.jsonl",
      "  # default mode is checkpoint",
      "  ava007 verify authority/replay/replay.jsonl --mode checkpoint --checkpoint-interval 5000",
      "  ava007 verify authority/replay/replay.jsonl --mode checkpoint --segments authority/replay/replay.segments.jsonl",
      "  ava007 verify authority/replay/replay.jsonl --json",
      "  ava007 verify authority/replay/replay.jsonl --json-out verification-report.json",
      "  ava007 trust bootstrap --entry ava007-authority-v1,2026-06-03T00:00:00.000Z --entry ava007-authority-v2,2026-07-01T00:00:00.000Z",
      "  ava007 replay normalize authority/replay/replay.jsonl --out authority/replay/replay-v3.jsonl --resign",
      "  ava007 replay segmentize authority/replay/replay-v3.jsonl --out authority/replay/replay.segments.jsonl --checkpoint-interval 5000",
      "  ava007 replay dedup authority/replay/replay-v3.jsonl --out authority/replay/replay.dedup.jsonl --checkpoint-interval 5000",
      "",
    ].join("\n"),
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
