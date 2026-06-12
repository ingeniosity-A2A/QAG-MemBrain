import { describe, expect, it } from "vitest";
import { ReconstructionQueryEngine } from "../../cortex/spatial/reconstructionQueryEngine.js";
import { SpatialCortex } from "../../cortex/spatial/spatialCortex.js";

describe("ReconstructionQueryEngine", () => {
  it("reconstructs authority and provenance chains", () => {
    const spatial = new SpatialCortex();
    spatial.upsertAtom({ atomId: "quote-812", type: "Quote", relationships: [], timestamp: "2026-06-03T00:00:00.000Z", authorityRoot: "root-1" });
    spatial.upsertAtom({ atomId: "decision-91", type: "Decision", relationships: [], timestamp: "2026-06-03T00:00:00.000Z", authorityRoot: "root-1" });
    spatial.upsertAtom({ atomId: "approval-policy:v4", type: "Policy", relationships: [], timestamp: "2026-06-03T00:00:00.000Z", authorityRoot: "root-1" });
    spatial.upsertAtom({ atomId: "governance-rule:12", type: "Rule", relationships: [], timestamp: "2026-06-03T00:00:00.000Z", authorityRoot: "root-1" });
    spatial.upsertAtom({ atomId: "deployment-version:1.0.0", type: "Deployment", relationships: [], timestamp: "2026-06-03T00:00:00.000Z", authorityRoot: "root-1" });
    spatial.upsertAtom({ atomId: "authority-signature:sig-1", type: "AuthoritySignature", relationships: [], timestamp: "2026-06-03T00:00:00.000Z", authorityRoot: "root-1" });

    spatial.addRelationship({ fromAtomId: "decision-91", toAtomId: "quote-812", relation: "approved", timestamp: "2026-06-03T00:00:01.000Z" });
    spatial.addRelationship({ fromAtomId: "decision-91", toAtomId: "approval-policy:v4", relation: "influenced_by", timestamp: "2026-06-03T00:00:01.000Z" });
    spatial.addRelationship({ fromAtomId: "approval-policy:v4", toAtomId: "governance-rule:12", relation: "originated_from", timestamp: "2026-06-03T00:00:01.000Z" });
    spatial.addRelationship({ fromAtomId: "governance-rule:12", toAtomId: "deployment-version:1.0.0", relation: "modified_by", timestamp: "2026-06-03T00:00:01.000Z" });
    spatial.addRelationship({ fromAtomId: "deployment-version:1.0.0", toAtomId: "authority-signature:sig-1", relation: "verified_by", timestamp: "2026-06-03T00:00:01.000Z" });
    spatial.addRelationship({ fromAtomId: "lineage-91", toAtomId: "decision-91", relation: "lineage_of", timestamp: "2026-06-03T00:00:01.000Z" });

    const queryEngine = new ReconstructionQueryEngine(spatial);
    const authority = queryEngine.showAuthorityChain("authority-signature:sig-1");
    const provenance = queryEngine.showProvenancePath("quote-812");
    const influence = queryEngine.showInfluenceGraph("approval-policy:v4");
    const lineage = queryEngine.showDecisionLineage("decision-91");

    expect(authority.authorityChain.join(" -> ")).toContain("governance-rule:12");
    expect(provenance.provenancePath.join(" -> ")).toContain("decision-91");
    expect(influence.reconstructionChain.join("|")).toContain("originated_from");
    expect(lineage.reconstructionChain.join("|")).toContain("lineage-91");
  });

  it("supports memory palace placement", () => {
    const spatial = new SpatialCortex();
    spatial.upsertRoom({ roomId: "customer-wing", name: "Customer Wing", description: "Customer operations" });
    spatial.upsertZone({ zoneId: "quotes", roomId: "customer-wing", name: "Quotes", description: "Quote state" });
    spatial.upsertAtom({ atomId: "quote-1", type: "Quote", relationships: [], timestamp: "2026-06-03T00:00:00.000Z", authorityRoot: "root-1" });

    spatial.setAtomLocation({ atomId: "quote-1", roomId: "customer-wing", zoneId: "quotes" });

    const location = spatial.getAtomLocation("quote-1");
    const atoms = spatial.getAtomsInZone("quotes");

    expect(location?.zoneId).toBe("quotes");
    expect(atoms.map((atom) => atom.atomId)).toContain("quote-1");
  });
});
