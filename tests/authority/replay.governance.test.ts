import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const GOV_ROOT = join(process.cwd(), "governance", "ava007");

describe("Authority replay governance", () => {
  it("enforces the replay policy rules", async () => {
    const content = await readFile(join(GOV_ROOT, "policies", "authority-replay-policy.xml"), "utf8");

    const rules = [...content.matchAll(/<rule>([^<]+)<\/rule>/g)].map((match) => match[1].trim());

    expect(rules).toEqual([
      "replay_cannot_use_model_reasoning=true",
      "replay_must_use_recorded_artifacts=true",
      "replay_must_be_deterministic=true",
      "replay_must_validate_policy_outcome=true",
      "replay_must_validate_hash_integrity=true",
      "replay_must_emit_failure_reasons=true",
    ]);
  });

  it("keeps replay policy included in the executive assembly", async () => {
    const content = await readFile(join(GOV_ROOT, "assemblies", "executive-assembly.xml"), "utf8");

    expect(content).toContain("<include>policies/authority-replay-policy.xml</include>");
  });
});