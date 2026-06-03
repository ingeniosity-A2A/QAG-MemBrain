import { createHash } from "node:crypto";

export interface MerkleProofItem {
  siblingHash: string;
  position: "left" | "right";
}

export interface MerkleProof {
  leafHash: string;
  rootHash: string;
  index: number;
  path: MerkleProofItem[];
}

export function buildMerkleRoot(values: string[]): string {
  if (values.length === 0) {
    throw new Error("Cannot build merkle root from empty values");
  }

  let level = values.map(hashLeaf);
  while (level.length > 1) {
    level = nextLevel(level);
  }

  return level[0];
}

export function generateProof(values: string[], index: number): MerkleProof {
  if (values.length === 0) {
    throw new Error("Cannot generate merkle proof from empty values");
  }

  if (index < 0 || index >= values.length) {
    throw new Error("Proof index out of bounds");
  }

  const levels: string[][] = [values.map(hashLeaf)];
  while (levels[levels.length - 1].length > 1) {
    levels.push(nextLevel(levels[levels.length - 1]));
  }

  const leafHash = levels[0][index];
  const rootHash = levels[levels.length - 1][0];
  const path: MerkleProofItem[] = [];

  let cursor = index;
  for (let depth = 0; depth < levels.length - 1; depth += 1) {
    const currentLevel = levels[depth];
    const isRightNode = cursor % 2 === 1;
    const siblingIndex = isRightNode ? cursor - 1 : cursor + 1;
    const siblingHash = currentLevel[siblingIndex] ?? currentLevel[cursor];

    path.push({
      siblingHash,
      position: isRightNode ? "left" : "right",
    });

    cursor = Math.floor(cursor / 2);
  }

  return {
    leafHash,
    rootHash,
    index,
    path,
  };
}

export function verifyProof(value: string, proof: MerkleProof): boolean {
  let computed = hashLeaf(value);
  if (computed !== proof.leafHash) {
    return false;
  }

  for (const item of proof.path) {
    computed = item.position === "left" ? hashPair(item.siblingHash, computed) : hashPair(computed, item.siblingHash);
  }

  return computed === proof.rootHash;
}

function nextLevel(level: string[]): string[] {
  const next: string[] = [];
  for (let i = 0; i < level.length; i += 2) {
    const left = level[i];
    const right = level[i + 1] ?? left;
    next.push(hashPair(left, right));
  }

  return next;
}

function hashLeaf(value: string): string {
  return createHash("sha256").update(`leaf:${value}`).digest("hex");
}

function hashPair(left: string, right: string): string {
  return createHash("sha256").update(`node:${left}:${right}`).digest("hex");
}
