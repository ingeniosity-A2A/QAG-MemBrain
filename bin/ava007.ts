#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { verifyArtifact } from "../authority/verification/verifyArtifact.js";
import { renderVerificationReport } from "../authority/verification/verificationReport.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command !== "verify") {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const artifactPathArg = args[1];
  if (!artifactPathArg) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const artifactPath = resolve(process.cwd(), artifactPathArg);
  const jsonOnly = args.includes("--json");
  const jsonOutIndex = args.indexOf("--json-out");
  const jsonOutPath = jsonOutIndex >= 0 ? args[jsonOutIndex + 1] : undefined;

  try {
    const report = await verifyArtifact(artifactPath);

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

function printUsage(): void {
  process.stderr.write(
    [
      "Usage:",
      "  ava007 verify <artifact-path> [--json] [--json-out <path>]",
      "",
      "Examples:",
      "  ava007 verify authority/replay/replay.jsonl",
      "  ava007 verify authority/replay/replay.jsonl --json",
      "  ava007 verify authority/replay/replay.jsonl --json-out verification-report.json",
      "",
    ].join("\n"),
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
