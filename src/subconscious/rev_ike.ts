import { ContractViolation } from "../contract/enforcement.js";
import { ObservationProposal } from "../shared/types.js";

export class RevIke {
  observe(signal: string, context: Record<string, unknown> = {}): ObservationProposal {
    return {
      id: `obs_${Date.now()}`,
      observed_by: "Rev.Ike",
      intent: signal.includes("stalled") ? "reframe_stalled_hardware" : "observe",
      confidence: signal.length > 0 ? 0.72 : 0,
      context,
    };
  }

  write(): never {
    throw new ContractViolation("Rev.Ike is L5 read-only and cannot write");
  }

  decide(): never {
    throw new ContractViolation("Rev.Ike is L5 read-only and cannot decide");
  }

  execute(): never {
    throw new ContractViolation("Rev.Ike is L5 read-only and cannot execute");
  }
}
