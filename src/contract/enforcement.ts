import { AuthorityLayer } from "../shared/types.js";

export class ContractViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContractViolation";
  }
}

export function assertCanWrite(layer: AuthorityLayer): void {
  if (layer !== "L1" && layer !== "L6") {
    throw new ContractViolation(`${layer} cannot write canonical memory`);
  }
}

export function assertCanDecide(layer: AuthorityLayer): void {
  if (layer !== "L6") {
    throw new ContractViolation(`${layer} cannot make executive decisions`);
  }
}

export function assertCanExecute(layer: AuthorityLayer): void {
  if (layer !== "L6") {
    throw new ContractViolation(`${layer} cannot execute actions`);
  }
}

export function enforceMaxDepth(depth: number, maxDepth = 5): void {
  if (!Number.isInteger(depth) || depth < 0 || depth > maxDepth) {
    throw new ContractViolation(`retrieval depth ${depth} exceeds max depth ${maxDepth}`);
  }
}
