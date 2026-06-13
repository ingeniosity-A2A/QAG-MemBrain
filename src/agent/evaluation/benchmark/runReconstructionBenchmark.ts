import { join } from "node:path";
import { writeJson } from "../shared/jsonl.js";
import { runReconstructionBenchmark } from "./reconstructionBenchmark.js";

function parseScales(args: string[]): number[] | undefined {
  const scalesArg = args.find((arg) => arg.startsWith("--scales="));
  if (!scalesArg) {
    return undefined;
  }

  const value = scalesArg.slice("--scales=".length);
  const parsed = value
    .split(",")
    .map((entry) => Number(entry.trim()))
    .filter((entry) => Number.isFinite(entry) && entry > 0)
    .map((entry) => Math.floor(entry));

  return parsed.length > 0 ? parsed : undefined;
}

function parseCheckpointInterval(args: string[]): number | undefined {
  const arg = args.find((entry) => entry.startsWith("--checkpoint-interval="));
  if (!arg) {
    return undefined;
  }

  const value = Number(arg.slice("--checkpoint-interval=".length));
  if (!Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  return Math.floor(value);
}

export async function runBenchmarkCli(args: string[] = process.argv.slice(2)): Promise<void> {
  const scales = parseScales(args);
  const checkpointInterval = parseCheckpointInterval(args);
  const outputArg = args.find((arg) => arg.startsWith("--out="));
  const outputPath = outputArg ? outputArg.slice("--out=".length) : "evaluation/reconstruction-benchmark.json";

  const report = await runReconstructionBenchmark({ scales, checkpointInterval });
  await writeJson(join(process.cwd(), outputPath), report);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runBenchmarkCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
