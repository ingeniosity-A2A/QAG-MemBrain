import { describe, expect, it } from "vitest";
import { AuditEngine } from "../../audit/decisions/decisionRecord.js";
import { BasicExecutiveRuntime } from "../../brain/executive/runtime.js";

describe("Lineage and audit integration", () => {
  it("writes audit records that reference lineage", async () => {
    const audit = new AuditEngine();
    const executive = new BasicExecutiveRuntime(audit);

    const lineage = executive.recordDecisionWithLineage({
      decisionId: "decision-audit-1",
      memoryAtoms: ["m1", "m2"],
      graphNodes: ["node1", "node2"],
      policiesApplied: ["policy-immutability"],
      timelineEvents: ["evt-1"],
      executivePlanId: "plan-77",
      executionPath: ["reflex", "executive"],
    });

    const records = audit.list();
    expect(records).toHaveLength(1);
    expect(records[0].lineageId).toBe(lineage.decisionId);
    expect(records[0].decisionHash).toBe(lineage.decisionHash);
    expect(records[0].memories).toEqual(["m1", "m2"]);
  });
});
