import { describe, expect, it } from "vitest";
import {
  buildGemmaTransformerPrompt,
  transformTacticalToPhilosophical,
} from "../../cognition/reflex/gemmaQueryTransformer.js";

describe("gemma query transformer", () => {
  it("builds a deterministic prompt and extracts themes", () => {
    const tactical = "Technician swarm stalled in Buckhead due to incompatible bracket";
    const prompt = buildGemmaTransformerPrompt(tactical);
    const transformed = transformTacticalToPhilosophical(tactical);

    expect(prompt).toContain("Query Transformer for Rev.IKE subconscious");
    expect(prompt).toContain(tactical);
    expect(transformed.themes).toContain("Refusing_Delay");
    expect(transformed.themes).toContain("Overcoming_Obstacles");
    expect(transformed.query).toContain("Reframe tactical pressure");
    expect(transformed.keywords.length).toBeGreaterThan(0);
  });
});
