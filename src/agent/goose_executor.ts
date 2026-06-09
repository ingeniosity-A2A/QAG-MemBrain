import { AVA007Decision } from "../shared/types.js";

export class GooseExecutor {
  async execute(decision: AVA007Decision): Promise<void> {
    console.log(`[Goose] Executing: ${decision.action}`, decision.params);
  }
}
