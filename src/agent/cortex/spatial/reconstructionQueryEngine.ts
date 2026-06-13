import { SpatialCortex, SpatialReconstruction } from "./spatialCortex.js";

export interface ReconstructionAnswer {
  question: string;
  answer: string;
  reconstructionChain: string[];
  authorityChain: string[];
  provenancePath: string[];
}

export class ReconstructionQueryEngine {
  constructor(private readonly spatial: SpatialCortex) {}

  showAuthorityChain(atomId: string): ReconstructionAnswer {
    const chain = this.traceIncoming(atomId, ["verified_by", "modified_by", "originated_from", "influenced_by"], 6);

    return {
      question: `Show authority chain for '${atomId}'`,
      answer: chain.length > 0 ? chain.join(" -> ") : "No authority chain found",
      reconstructionChain: chain,
      authorityChain: chain,
      provenancePath: this.provenancePath(atomId),
    };
  }

  showProvenancePath(atomId: string): ReconstructionAnswer {
    const path = this.traceIncoming(
      atomId,
      ["approved", "lineage_of", "generated_by", "influenced_by", "originated_from", "modified_by"],
      8,
    );

    return {
      question: `Show provenance path for '${atomId}'`,
      answer: path.length > 0 ? path.join(" -> ") : "No provenance path found",
      reconstructionChain: path,
      authorityChain: this.authorityChain(atomId),
      provenancePath: path,
    };
  }

  showInfluenceGraph(atomId: string): ReconstructionAnswer {
    const incoming = this.spatial
      .getIncoming(atomId)
      .filter((entry) => ["influenced_by", "originated_from", "modified_by"].includes(entry.relation));
    const outgoing = this.spatial
      .getOutgoing(atomId)
      .filter((entry) => ["influenced_by", "originated_from", "modified_by"].includes(entry.relation));

    const influence = [...incoming, ...outgoing].map(
      (entry) => `${entry.fromAtomId}:${entry.relation}:${entry.toAtomId}`,
    );
    return {
      question: `Show influence graph for '${atomId}'`,
      answer: influence.length > 0 ? influence.join(", ") : "No influence graph found",
      reconstructionChain: influence,
      authorityChain: this.authorityChain(atomId),
      provenancePath: this.provenancePath(atomId),
    };
  }

  showDecisionLineage(decisionId: string): ReconstructionAnswer {
    const lineage = this.traceIncoming(decisionId, ["lineage_of", "generated_by", "influenced_by"], 6);
    return {
      question: `Show decision lineage for '${decisionId}'`,
      answer: lineage.length > 0 ? lineage.join(" -> ") : "No decision lineage found",
      reconstructionChain: lineage,
      authorityChain: this.authorityChain(decisionId),
      provenancePath: this.provenancePath(decisionId),
    };
  }

  whatCreatedState(atomId: string): ReconstructionAnswer {
    const incoming = this.spatial.getIncoming(atomId);
    const reconstruction = this.spatial.reconstruct({ centerAtomId: atomId, maxDepth: 3 });

    const creators = incoming.map((relationship) => relationship.fromAtomId);
    return {
      question: `What created state '${atomId}'?`,
      answer: creators.length > 0 ? creators.join(", ") : "No creator relationship found",
      reconstructionChain: chainFromReconstruction(reconstruction),
      authorityChain: this.authorityChain(atomId),
      provenancePath: this.provenancePath(atomId),
    };
  }

  whatDecisionsInfluencedQuote(quoteId: string): ReconstructionAnswer {
    const incoming = this.spatial.getIncoming(quoteId);
    const influencing = incoming
      .filter((relationship) => relationship.relation === "influenced_by" || relationship.relation === "approved")
      .map((relationship) => relationship.fromAtomId);

    return {
      question: `What decisions influenced '${quoteId}'?`,
      answer: influencing.length > 0 ? influencing.join(", ") : "No influencing decisions found",
      reconstructionChain: influencing,
      authorityChain: this.authorityChain(quoteId),
      provenancePath: this.provenancePath(quoteId),
    };
  }

  showReconstructionChain(atomId: string): ReconstructionAnswer {
    const reconstruction = this.spatial.reconstruct({ centerAtomId: atomId, maxDepth: 4 });

    return {
      question: `Show reconstruction chain for '${atomId}'`,
      answer: `Visited ${reconstruction.visitedAtoms.length} atoms and ${reconstruction.traversedRelationships.length} relationships`,
      reconstructionChain: chainFromReconstruction(reconstruction),
      authorityChain: this.authorityChain(atomId),
      provenancePath: this.provenancePath(atomId),
    };
  }

  private authorityChain(atomId: string): string[] {
    const atom = this.spatial.getAtom(atomId);
    if (!atom) {
      return [];
    }

    const incoming = this.spatial.getIncoming(atomId);
    const verifiers = incoming
      .filter((relationship) => relationship.relation === "verified_by")
      .map((relationship) => relationship.fromAtomId);

    return [atom.authorityRoot, ...verifiers];
  }

  private provenancePath(atomId: string): string[] {
    const incoming = this.spatial.getIncoming(atomId);
    return incoming.map((relationship) => `${relationship.fromAtomId}:${relationship.relation}:${relationship.toAtomId}`);
  }

  private traceIncoming(atomId: string, preferredRelations: string[], maxDepth: number): string[] {
    const chain: string[] = [atomId];
    let cursor = atomId;
    let depth = 0;

    while (depth < maxDepth) {
      const incoming = this.spatial.getIncoming(cursor);
      const next = incoming.find((entry) => preferredRelations.includes(entry.relation));
      if (!next) {
        break;
      }

      chain.push(next.fromAtomId);
      cursor = next.fromAtomId;
      depth += 1;
    }

    return chain;
  }
}

function chainFromReconstruction(reconstruction: SpatialReconstruction): string[] {
  return reconstruction.traversedRelationships.map(
    (relationship) => `${relationship.fromAtomId}:${relationship.relation}:${relationship.toAtomId}`,
  );
}
