import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const GOV_ROOT = join(process.cwd(), "governance", "ava007");

describe("Authority replay governance policy", () => {
  it("enforces deterministic replay and failure reason emission", async () => {
    const content = await readFile(join(GOV_ROOT, "policies", "authority-replay-policy.xml"), "utf8");
    const rules = [...content.matchAll(/<rule>([^<]+)<\/rule>/g)].map((match) => match[1].trim());

    expect(rules).toContain("replay_cannot_use_model_reasoning=true");
    expect(rules).toContain("replay_must_use_recorded_artifacts=true");
    expect(rules).toContain("replay_must_be_deterministic=true");
    expect(rules).toContain("replay_must_validate_policy_outcome=true");
    expect(rules).toContain("replay_must_validate_hash_integrity=true");
    expect(rules).toContain("replay_must_emit_failure_reasons=true");
  });
});