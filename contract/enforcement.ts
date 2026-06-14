export const CONTRACT_VERSION = "1.0.0";

export const LAYERS = {
  REFLEX: "reflex",
  EXECUTIVE: "executive",
  CORTEX: "cortex",
  GOOSE: "goose",
  REV_IKE: "rev_ike",
  AVA_007: "ava007",
} as const;

export class ContractViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContractViolation";
  }
}

export function assertCanDecide(layer: string): void {
  if (layer !== LAYERS.AVA_007) {
    throw new ContractViolation(`Decide forbidden for layer: ${layer}`);
  }
}

export function assertCanExecute(layer: string): void {
  if (layer !== LAYERS.AVA_007 && layer !== LAYERS.GOOSE) {
    throw new ContractViolation(`Execute forbidden for layer: ${layer}`);
  }
}

export function assertCanWrite(layer: string): void {
  if (layer !== LAYERS.AVA_007) {
    throw new ContractViolation(`Write forbidden for layer: ${layer}`);
  }
}
