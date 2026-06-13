import { MemoryChallenge } from "./types.js";

export function buildMemoryChallenges(atomIds: string[]): MemoryChallenge[] {
  return atomIds.map((atomId, index) => {
    const domain = domainByIndex(index);

    return {
      id: `challenge-${index + 1}`,
      prompt: `Reconstruct authority and provenance path for '${atomId}' in domain '${domain}'`,
      targetAtomId: atomId,
      domain,
      expectedTokens: [atomId, "approved", "verified"],
      expectedAuthorityTokens: ["authority-signature", "governance-rule", "approval-policy"],
      expectedLineageTokens: ["lineage", "decision", "approval-policy"],
      expectedRelationshipTokens: ["influenced_by", "originated_from", "modified_by", "verified_by"],
      minProvenanceDepth: 3,
    };
  });
}

function domainByIndex(index: number): MemoryChallenge["domain"] {
  const domains: MemoryChallenge["domain"][] = [
    "customer-support",
    "quoting",
    "assembly",
    "provenance",
    "visual-assets",
  ];

  return domains[index % domains.length];
}
