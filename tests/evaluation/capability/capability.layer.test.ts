import { describe, expect, it } from "vitest";
import { buildCapabilityCases } from "../../../evaluation/capability/cases.js";

describe("Capability evaluation cases", () => {
  it("builds 100 contract + 100 support + 100 orchestration cases", () => {
    const cases = buildCapabilityCases();
    const contract = cases.filter((entry) => entry.capability === "contract_reasoning");
    const support = cases.filter((entry) => entry.capability === "support");
    const orchestration = cases.filter((entry) => entry.capability === "orchestration");

    expect(cases).toHaveLength(300);
    expect(contract).toHaveLength(100);
    expect(support).toHaveLength(100);
    expect(orchestration).toHaveLength(100);
  });
});
