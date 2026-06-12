import { describe, expect, it } from "vitest";
import { buildMerkleRoot, generateProof, verifyProof } from "../../trust/merkle/merkleProof.js";

describe("Merkle proofs", () => {
  it("builds tree and verifies proofs", () => {
    const values = ["a", "b", "c", "d", "e"];
    const root = buildMerkleRoot(values);
    const proof = generateProof(values, 2);

    expect(proof.rootHash).toBe(root);
    expect(verifyProof("c", proof)).toBe(true);
  });

  it("rejects altered proofs", () => {
    const values = ["a", "b", "c"];
    const proof = generateProof(values, 1);

    const altered = {
      ...proof,
      path: proof.path.map((item, index) =>
        index === 0
          ? {
              ...item,
              siblingHash: item.siblingHash.replace(/./, "f"),
            }
          : item,
      ),
    };

    expect(verifyProof("b", altered)).toBe(false);
  });
});
